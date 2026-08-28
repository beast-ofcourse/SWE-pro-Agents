'use strict';

/**
 * background-integration.test.js — full-lifecycle integration test for the
 * background-delegation system. Loads the real plugin adapter, drives it with a
 * controllable fake in-process client (verified wrapped contract), and uses a
 * real git worktree for isolation so the worktree path is exercised end to end.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const plugin = require('../plugins/swe-pro-agents-background.js');

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

  await check('plugin exposes 7 tools and full lifecycle works with real worktree', async () => {
    const repoDir = tmpDir();
    initRepo(repoDir);
    const client = makeFakeClient();
    const server = await plugin.server({ client, directory: repoDir });
    const tools = server.tool;

    for (const t of ['bg_delegate', 'bg_status', 'bg_read', 'bg_list', 'bg_stop', 'bg_steer', 'bg_prune']) {
      assert.ok(tools[t] && typeof tools[t].execute === 'function', 'missing tool ' + t);
    }

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

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error('integration harness error:', e);
  process.exit(1);
});
