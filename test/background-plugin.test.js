'use strict';

/**
 * background-plugin.test.js — drives plugins/swe-pro-agents.js (background
 * delegation half) end-to-end with a fake in-process client. Verifies tool
 * shapes, delegation flow, and that a parent notification fires on terminal.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createBackgroundDelegate } = require('../plugins/swe-pro-agents.js');

// Isolate delegations from the real store and disable the supervisor timer so the
// test controls reconciliation.
process.env.SWE_PRO_DELEGATIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-pl-store-'));
process.env.SWE_PRO_BG_SUPERVISOR = '0';

const plugin = require('../plugins/swe-pro-agents.js');

function makeFakeClient() {
  const sessions = {};
  let createCount = 0;
  const messageCalls = [];
  const promptCalls = [];
  return {
    _stats: () => ({ createCount, messageCalls, promptCalls }),
    _markComplete: (id, text) => {
      if (sessions[id]) {
        sessions[id].tokens.output = 5;
        sessions[id].state = 'completed';
        sessions[id]._result = text || 'RESULT';
      }
    },
    _setPartial: (id, text) => {
      if (sessions[id]) sessions[id]._partial = text;
    },
    session: {
      async create() {
        createCount += 1;
        const id = 'child_' + createCount;
        sessions[id] = { id, tokens: { output: 0 }, state: 'running', _result: '' };
        return { data: sessions[id] };
      },
      async prompt({ path, body }) {
        promptCalls.push({ id: path.id, body });
        return Promise.resolve({ ok: true });
      },
      async get({ path }) {
        const s = sessions[path.id];
        return { data: s ? Object.assign({}, s) : { id: path.id, tokens: { output: 0 }, state: 'running' } };
      },
      async abort({ path }) {
        if (sessions[path.id]) sessions[path.id].state = 'cancelled';
        return { ok: true };
      },
      async messages({ path }) {
        const s = sessions[path.id];
        if (s && s._partial) return { data: [{ role: 'assistant', content: s._partial }] };
        if (s && s._result) return { data: [{ role: 'assistant', content: s._result }] };
        return { data: [] };
      },
      async message({ path, body }) {
        messageCalls.push({ id: path.id, body });
        return Promise.resolve({ ok: true });
      },
    },
  };
}

async function run() {
  let passed = 0;
  let failed = 0;
  function check(name, fn) {
    return fn()
      .then(() => {
        console.log('PASS  ' + name);
        passed += 1;
      })
      .catch((err) => {
        console.log('FAIL  ' + name + ': ' + err.message);
        failed += 1;
      });
  }

  const client = makeFakeClient();
  const hooks = await plugin.server({ client, directory: '/tmp' });
  const tools = hooks.tool;
  assert.ok(tools.bg_delegate && tools.bg_status && tools.bg_read && tools.bg_list && tools.bg_stop && tools.bg_steer, 'all 6 tools defined');

  await check('bg_delegate returns a stable id and creates a running delegation', async () => {
    const ret = await tools.bg_delegate.execute({ prompt: 'research X', agent: 'swe-x' }, { sessionID: 'parent1' });
    const m = ret.match(/delegated (bg_\S+)/);
    assert.ok(m, 'return contains delegated id: ' + ret);
    const id = m[1];
    const list = await tools.bg_status.execute({});
    assert.ok(list.includes(id), 'status lists the new delegation');
  });

  await check('bg_read returns result and fires parent notification on terminal', async () => {
    const ret = await tools.bg_delegate.execute({ prompt: 'do work' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const st = JSON.parse(await tools.bg_status.execute({ id }));
    client._markComplete(st.childSessionID, 'CHILD OUTPUT');
    const result = await tools.bg_read.execute({ id });
    assert.strictEqual(result, 'CHILD OUTPUT', 'bg_read returns child result');
    const stats = client._stats();
    assert.ok(stats.messageCalls.length >= 1, 'parent notification fired');
    const note = stats.messageCalls[stats.messageCalls.length - 1];
    assert.strictEqual(note.id, 'parent1', 'notification sent to parent session');
    assert.ok(JSON.stringify(note.body).includes(id), 'notification references the delegation id');
  });

  await check('bg_stop cancels and aborts the child', async () => {
    const ret = await tools.bg_delegate.execute({ prompt: 'long task' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const stopRet = await tools.bg_stop.execute({ id, signal: 'hard' });
    assert.ok(stopRet.includes('stopped'), 'stop returns stopped status');
    assert.ok(stopRet.includes('cancelled'), 'state cancelled');
    assert.strictEqual(client._stats().createCount, 3, 'three children created total');
  });

  await check('bg_steer prompts the running child (best-effort)', async () => {
    const ret = await tools.bg_delegate.execute({ prompt: 'task' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const st = JSON.parse(await tools.bg_status.execute({ id }));
    const steerRet = await tools.bg_steer.execute({ id, prompt: 'also check Y' });
    assert.ok(steerRet.includes('steered'), 'steer returns steered status');
    const promptCalls = client._stats().promptCalls;
    const steered = promptCalls.find((p) => p.id === st.childSessionID && JSON.stringify(p.body).includes('also check Y'));
    assert.ok(steered, 'child was prompted with the steer instruction');
    assert.ok(JSON.stringify(steered.body).includes('also check Y'), 'steer prompt body contains instruction');
  });

  await check('bg_delegate rejects missing prompt', async () => {
    const ret = await tools.bg_delegate.execute({}, { sessionID: 'parent1' });
    assert.ok(ret.includes('error'), 'returns error string for missing prompt');
  });

  await check('bg_list returns JSON array', async () => {
    const ret = await tools.bg_list.execute({});
    const arr = JSON.parse(ret);
    assert.ok(Array.isArray(arr), 'bg_list returns an array');
  });

  await check('bg_merge --check returns diff report and never merges (fake worktree)', async () => {
    // Real temp repo + real branch, but a FAKE worktree record (path never
    // created on disk): the check needs only repoDir + branch, no checkout.
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-pl-wt-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'README.md'), 'init\n');
    execFileSync('git', ['add', 'README.md'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo });
    execFileSync('git', ['checkout', '-q', '-b', 'bg-fake1'], { cwd: repo });
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'a\nb\n');
    execFileSync('git', ['add', 'feature.txt'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'feature'], { cwd: repo });
    execFileSync('git', ['checkout', '-q', '-'], { cwd: repo }); // HEAD back to base so merge-base is the fork point
    const headBefore = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim();
    const branchTipBefore = execFileSync('git', ['rev-parse', 'bg-fake1'], { cwd: repo }).toString().trim();

    // Second engine sharing the plugin store, with a stub worktreeManager
    // whose setup records a FAKE worktree (never touches disk).
    const fakePath = path.join(repo, '.worktrees', 'bg-fake1');
    const stubManager = {
      setup: async () => ({ path: fakePath, branch: 'bg-fake1', repoDir: repo }),
      remove: async () => {},
    };
    const bg2 = createBackgroundDelegate({
      client: makeFakeClient(),
      storeDir: process.env.SWE_PRO_DELEGATIONS_DIR,
      directory: repo,
      repoDir: repo,
      worktreeManager: stubManager,
    });
    const id = await bg2.createDelegation({ prompt: 'write code', mode: 'worktree' });
    assert.ok(!fs.existsSync(fakePath), 'worktree path is fake (never on disk)');
    const stateFile = path.join(process.env.SWE_PRO_DELEGATIONS_DIR, id + '.json');
    const journalFile = path.join(process.env.SWE_PRO_DELEGATIONS_DIR, id + '.journal.jsonl');
    const stateBefore = fs.readFileSync(stateFile, 'utf-8');
    const journalBefore = fs.existsSync(journalFile) ? fs.readFileSync(journalFile, 'utf-8') : '';

    const ret = await tools.bg_merge.execute({ id, check: true });
    const report = JSON.parse(ret);
    assert.strictEqual(report.filesChanged, 1, 'one file changed: ' + ret);
    assert.strictEqual(report.insertions, 2, 'two insertions: ' + ret);
    assert.strictEqual(report.deletions, 0, 'zero deletions: ' + ret);
    assert.ok(report.conflictProbability === 'low' || report.conflictProbability === 'high', 'conflictProbability present: ' + ret);
    assert.ok(typeof report.base === 'string' && report.base.length > 0, 'base present: ' + ret);

    // Never merges: no state/journal writes, HEAD and branch tip untouched.
    assert.strictEqual(fs.readFileSync(stateFile, 'utf-8'), stateBefore, 'state file untouched');
    const journalAfter = fs.existsSync(journalFile) ? fs.readFileSync(journalFile, 'utf-8') : '';
    assert.strictEqual(journalAfter, journalBefore, 'journal untouched (read-only query)');
    assert.strictEqual(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo }).toString().trim(), headBefore, 'HEAD untouched');
    assert.strictEqual(execFileSync('git', ['rev-parse', 'bg-fake1'], { cwd: repo }).toString().trim(), branchTipBefore, 'branch tip untouched');
  });

  await check('bg_merge on readonly delegation returns not-applicable', async () => {
    const ret = await tools.bg_delegate.execute({ prompt: 'research Y' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const out = await tools.bg_merge.execute({ id, check: true });
    const parsed = JSON.parse(out);
    assert.strictEqual(parsed.applicable, false, 'readonly → applicable false: ' + out);
    assert.ok(/merge not applicable/.test(parsed.reason || ''), 'reason states merge not applicable: ' + out);
  });

  await check('bg_resume on readonly delegation returns cannot_resume (passthrough)', async () => {
    assert.ok(tools.bg_resume, 'bg_resume tool defined');
    const ret = await tools.bg_delegate.execute({ prompt: 'research Z' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const out = await tools.bg_resume.execute({ id });
    assert.ok(out.includes('cannot_resume'), 'readonly resume must report cannot_resume (got ' + out + ')');
    assert.ok(out.includes('no_worktree'), 'reason must be no_worktree (got ' + out + ')');
  });

  await check('bg_dashboard prints a tree with delegation fields', async () => {
    assert.ok(tools.bg_dashboard, 'bg_dashboard tool defined');
    const ret = await tools.bg_delegate.execute({ prompt: 'dashboard work', agent: 'swe-dash' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const tree = await tools.bg_dashboard.execute({});
    assert.ok(tree.includes(id), 'tree lists the new delegation: ' + tree);
    assert.ok(tree.includes('running'), 'tree shows state: ' + tree);
    assert.ok(tree.includes('swe-dash'), 'tree shows agent: ' + tree);
    assert.ok(!tree.includes('no active delegations'), 'non-empty store never prints the empty line');
  });

  await check('bg_status --json returns logPath per item', async () => {
    const ret = await tools.bg_delegate.execute({ prompt: 'json work' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const single = JSON.parse(await tools.bg_status.execute({ id, json: true }));
    assert.strictEqual(single.id, id, 'single-item json keeps the id');
    assert.ok(typeof single.logPath === 'string' && single.logPath.endsWith(id + '.log'), 'single logPath: ' + single.logPath);
    const all = JSON.parse(await tools.bg_status.execute({ json: true }));
    assert.ok(Array.isArray(all) && all.length > 0, 'array json is non-empty');
    for (const item of all) {
      assert.ok(typeof item.logPath === 'string' && item.logPath.endsWith(item.id + '.log'), 'every item carries logPath: ' + JSON.stringify(item));
    }
    const plain = JSON.parse(await tools.bg_status.execute({ id }));
    assert.strictEqual(plain.id, id, 'plain (non-json) status shape unchanged');
  });

  await check('bg_read stream:true appends partials to the task log', async () => {
    // Fresh server instance (fresh scheduler): earlier checks leave running
    // delegations behind and the engine caps parallelism, so this guarantees
    // the new delegation actually starts instead of queueing as `registered`.
    const streamClient = makeFakeClient();
    const streamTools = (await plugin.server({ client: streamClient, directory: '/tmp' })).tool;
    const ret = await streamTools.bg_delegate.execute({ prompt: 'streaming work' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const st = JSON.parse(await streamTools.bg_status.execute({ id }));
    assert.ok(st.childSessionID, 'delegation started (slot free on the fresh scheduler)');
    streamClient._setPartial(st.childSessionID, 'PLUGIN-STREAM-PARTIAL');
    const outcome = await streamTools.bg_read.execute({ id, timeoutMs: 150, stream: true });
    assert.strictEqual(outcome, 'timeout: still running', 'read still returns normally: ' + outcome);
    const logText = fs.readFileSync(path.join(process.env.SWE_PRO_DELEGATIONS_DIR, id + '.log'), 'utf-8');
    assert.ok(logText.includes('PLUGIN-STREAM-PARTIAL'), 'streaming partial reached the log: ' + logText);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
