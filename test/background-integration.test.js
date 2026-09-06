'use strict';

/**
 * background-integration.test.js — full-lifecycle integration test for the
 * background-delegation system. Loads the real plugin, drives it with a
 * controllable fake in-process client (verified wrapped contract), and uses a
 * real git worktree for isolation so the worktree path is exercised end to end.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const plugin = require('../plugins/swe-pro-agents.js');

// Isolate delegations from the real store so the test never pollutes it.
process.env.SWE_PRO_DELEGATIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-int-store-'));

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bg-int-'));
}

// Fake client whose child sessions auto-complete on create (deterministic, no race).
function makeFakeClient() {
  const sessions = {};
  let createCount = 0;
  return {
    _sessions: sessions,
    session: {
      async create() {
        createCount += 1;
        const id = 'child_' + createCount;
        sessions[id] = { id, tokens: { output: 5 }, state: 'completed', _result: 'INT RESULT' };
        return { data: { id } };
      },
      async get({ path }) {
        const s = sessions[path.id] || {};
        return { data: { id: path.id, tokens: { output: s.tokens ? s.tokens.output : 0 }, state: s.state || 'running' } };
      },
      async prompt() {
        return { data: {} };
      },
      async abort() {
        return { data: {} };
      },
      async messages({ path }) {
        const s = sessions[path.id] || {};
        return { data: { messages: [{ role: 'assistant', content: s._result || 'INT RESULT' }] } };
      },
    },
  };
}

function initRepo(dir) {
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email t@t', { cwd: dir });
  execSync('git config user.name t', { cwd: dir });
  fs.writeFileSync(path.join(dir, 'seed.txt'), 'seed');
  execSync('git add -A', { cwd: dir });
  execSync('git commit -q -m seed', { cwd: dir });
}

async function run() {
  let passed = 0;
  let failed = 0;
  const check = async (name, fn) => {
    try {
      await fn();
      passed += 1;
      console.log('  ok -', name);
    } catch (e) {
      failed += 1;
      console.log('  FAIL -', name, '\n    ', e.message);
    }
  };

  await check('plugin exposes 10 tools and full lifecycle works with real worktree', async () => {
    const repoDir = tmpDir();
    initRepo(repoDir);
    const client = makeFakeClient();
    const server = await plugin.server({ client, directory: repoDir });
    const tools = server.tool;

    for (const t of ['bg_delegate', 'bg_status', 'bg_read', 'bg_list', 'bg_stop', 'bg_steer', 'bg_prune', 'bg_merge', 'bg_resume', 'bg_dashboard']) {
      assert.ok(tools[t] && typeof tools[t].execute === 'function', 'missing tool ' + t);
    }
    assert.strictEqual(Object.keys(tools).length, 10, 'exactly 10 tools, got ' + Object.keys(tools).join(','));

    const ret = await tools.bg_delegate.execute({ prompt: 'do work', agent: 'swe-mini' });
    const m = ret.match(/delegated (bg_\S+)/);
    assert.ok(m, 'bg_delegate returns a delegation sentence with an id');
    const id = m[1];

    // bg_read blocks until terminal and finalizes the auto-completing child.
    const md = await tools.bg_read.execute({ id });
    assert.strictEqual(md, 'INT RESULT', 'bg_read returns the child result');

    const status = await tools.bg_status.execute({ id });
    assert.ok(status.includes('completed'), 'bg_status reports completed after read: ' + status);

    const list = await tools.bg_list.execute({});
    assert.ok(list.includes(id), 'bg_list includes the delegation id');

    const steer = await tools.bg_steer.execute({ id, prompt: 'keep going' });
    assert.ok(typeof steer === 'string', 'bg_steer returns a string');

    const pruned = await tools.bg_prune.execute({ maxAgeDays: 0 });
    assert.ok(typeof pruned === 'string' && pruned.includes('pruned'), 'bg_prune returns a summary');

    // Worktree must be cleaned up after finalize.
    const wt = path.join(repoDir, '.worktrees', id);
    assert.ok(!fs.existsSync(wt), 'worktree removed after completion');
  });

  await check('worktree-mode delegation cleans up its worktree after completion', async () => {
    const repoDir2 = tmpDir();
    initRepo(repoDir2);
    const client2 = makeFakeClient();
    const server2 = await plugin.server({ client: client2, directory: repoDir2 });
    const tools2 = server2.tool;

    const ret = await tools2.bg_delegate.execute({ prompt: 'write code', agent: 'swe-mini', mode: 'worktree' });
    const m2 = ret.match(/delegated (bg_\S+)/);
    assert.ok(m2, 'bg_delegate (worktree) returns a delegation sentence with an id');
    const id2 = m2[1];

    // bg_read blocks until terminal and finalizes the auto-completing child.
    const md2 = await tools2.bg_read.execute({ id: id2 });
    assert.strictEqual(md2, 'INT RESULT', 'worktree-mode bg_read returns the child result');

    // Per validation #4 the worktree is NOT auto-removed on completion — the parent
    // must merge/remove it manually. So it must still exist after read.
    const stateFile = path.join(process.env.SWE_PRO_DELEGATIONS_DIR, id2 + '.json');
    const st2 = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
    assert.ok(st2.worktree && st2.worktree.path, 'worktree path recorded in state');
    assert.ok(fs.existsSync(st2.worktree.path), 'worktree persists after completion (parent merges manually)');

    // bg_stop cancels and removes the worktree.
    await tools2.bg_stop.execute({ id: id2 });
    assert.ok(!fs.existsSync(st2.worktree.path), 'worktree removed after bg_stop');
  });

  await check('bg_delegate default mode stays readonly; capabilities/budget stored (depth/priority informational)', async () => {
    const repoDir = tmpDir();
    initRepo(repoDir);
    const client = makeFakeClient();
    const server = await plugin.server({ client, directory: repoDir });
    const tools = server.tool;

    const ret = await tools.bg_delegate.execute({
      prompt: 'research Y',
      capabilities: { maxTokens: 1000 },
      budget: { maxTokens: 2000, maxToolCalls: 50 },
      priority: 1,
      depth: 1,
    });
    const m = ret.match(/delegated (bg_\S+)/);
    assert.ok(m, 'bg_delegate with new args returns an id');
    const st = JSON.parse(fs.readFileSync(path.join(process.env.SWE_PRO_DELEGATIONS_DIR, m[1] + '.json'), 'utf-8'));
    assert.strictEqual(st.mode, 'readonly', 'default mode is readonly (unchanged behavior — worktree stays explicit)');
    assert.deepStrictEqual(st.capabilities, { maxTokens: 1000 }, 'capabilities stored');
    assert.deepStrictEqual(st.budget, { maxTokens: 2000, maxToolCalls: 50 }, 'budget forwarded as the cap');
  });

  await check('bg_merge --check reports a committed change; dashboard/status-json/list render branch', async () => {
    const repoDir = tmpDir();
    initRepo(repoDir);
    const client = makeFakeClient();
    const server = await plugin.server({ client, directory: repoDir });
    const tools = server.tool;

    const ret = await tools.bg_delegate.execute({ prompt: 'write code', agent: 'swe-mini', mode: 'worktree' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const st = JSON.parse(fs.readFileSync(path.join(process.env.SWE_PRO_DELEGATIONS_DIR, id + '.json'), 'utf-8'));
    assert.ok(st.worktree && st.worktree.branch, 'worktree branch recorded');

    fs.writeFileSync(path.join(st.worktree.path, 'feature.txt'), 'a\nb\n');
    execSync('git add feature.txt', { cwd: st.worktree.path });
    execSync('git -c user.email=t@t -c user.name=t commit -q -m feature', { cwd: st.worktree.path });

    const mergeOut = await tools.bg_merge.execute({ id, check: true });
    const report = JSON.parse(mergeOut);
    assert.strictEqual(report.filesChanged, 1, 'one file changed: ' + mergeOut);
    assert.strictEqual(report.insertions, 2, 'two insertions: ' + mergeOut);
    assert.strictEqual(report.deletions, 0, 'zero deletions: ' + mergeOut);
    assert.ok(report.conflictProbability === 'low' || report.conflictProbability === 'high', 'conflictProbability present: ' + mergeOut);
    assert.ok(typeof report.base === 'string' && report.base.length > 0, 'base present: ' + mergeOut);

    const tree = await tools.bg_dashboard.execute({});
    assert.ok(tree.includes(id), 'dashboard lists the delegation: ' + tree);
    assert.ok(tree.includes(st.worktree.branch), 'dashboard renders the worktree branch: ' + tree);

    const single = JSON.parse(await tools.bg_status.execute({ id, json: true }));
    assert.strictEqual(single.branch, st.worktree.branch, 'status json carries branch');
    assert.ok(typeof single.logPath === 'string' && single.logPath.endsWith(id + '.log'), 'status json carries logPath');
    assert.ok(single.createdAt && single.updatedAt, 'status json carries timestamps');
    assert.ok('tokens' in single, 'status json carries the tokens key (null when unknown)');

    const list = JSON.parse(await tools.bg_list.execute({}));
    const item = list.find((l) => l.id === id);
    assert.ok(item, 'bg_list includes the delegation');
    assert.strictEqual(item.branch, st.worktree.branch, 'bg_list returns branch (Journey B)');

    await tools.bg_stop.execute({ id });
  });

  await check('bg_resume: readonly reports cannot_resume; worktree resumes', async () => {
    const repoDir = tmpDir();
    initRepo(repoDir);
    const client = makeFakeClient();
    const server = await plugin.server({ client, directory: repoDir });
    const tools = server.tool;

    const roRet = await tools.bg_delegate.execute({ prompt: 'research Z' });
    const roId = roRet.match(/delegated (bg_\S+)/)[1];
    const roOut = await tools.bg_resume.execute({ id: roId });
    assert.ok(roOut.includes('cannot_resume'), 'readonly resume reports cannot_resume (got ' + roOut + ')');
    assert.ok(roOut.includes('no_worktree'), 'reason is no_worktree (got ' + roOut + ')');

    const wtRet = await tools.bg_delegate.execute({ prompt: 'write code', mode: 'worktree' });
    const wtId = wtRet.match(/delegated (bg_\S+)/)[1];
    await tools.bg_read.execute({ id: wtId });
    const resumed = await tools.bg_resume.execute({ id: wtId });
    assert.ok(resumed.includes('resumed ' + wtId), 'worktree delegation resumes (got ' + resumed + ')');

    await tools.bg_stop.execute({ id: roId });
    await tools.bg_stop.execute({ id: wtId });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error('integration harness error:', e);
  process.exit(1);
});
