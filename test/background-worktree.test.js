'use strict';

/**
 * background-worktree.test.js — real-git tests for worktree write-mode.
 * Creates temp git repos, exercises setup/remove (committed + uncommitted),
 * and the integration with createBackgroundDelegate (mode:worktree).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createWorktreeManager, createBackgroundDelegate } = require('../plugins/swe-pro-agents.js');

function initTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-wt-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'README.md'), 'init\n');
  execFileSync('git', ['add', 'README.md'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });
  return dir;
}

function makeFakeClient() {
  const sessions = {};
  let n = 0;
  return {
    _markComplete: (id, text) => {
      if (sessions[id]) {
        sessions[id].tokens.output = 5;
        sessions[id].state = 'completed';
        sessions[id]._result = text || 'R';
      }
    },
    session: {
      async create() {
        n += 1;
        const id = 'child_' + n;
        sessions[id] = { id, tokens: { output: 0 }, state: 'running', _result: '' };
        return { data: sessions[id] };
      },
      async prompt() {
        return Promise.resolve({ ok: true });
      },
      async get({ path }) {
        const s = sessions[path.id];
        return { data: s ? Object.assign({}, s) : { id: path.id, tokens: { output: 0 }, state: 'running' } };
      },
      async abort() {
        return { ok: true };
      },
      async messages({ path }) {
        const s = sessions[path.id];
        if (s && s._result) return { data: [{ role: 'assistant', content: s._result }] };
        return { data: [] };
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
      .catch((e) => {
        console.log('FAIL  ' + name + ': ' + e.message);
        failed += 1;
      });
  }

  await check('worktree setup creates dir + branch', async () => {
    const repo = initTempRepo();
    const wm = createWorktreeManager();
    const wt = await wm.setup(repo, 'bg_test1');
    assert.ok(fs.existsSync(wt.path), 'worktree dir exists');
    execFileSync('git', ['rev-parse', '--verify', wt.branch], { cwd: repo }); // throws if missing
    await wm.remove(wt);
  });

  await check('worktree remove (committed) cleans up', async () => {
    const repo = initTempRepo();
    const wm = createWorktreeManager();
    const wt = await wm.setup(repo, 'bg_test2');
    fs.writeFileSync(path.join(wt.path, 'file.txt'), 'hello');
    execFileSync('git', ['add', 'file.txt'], { cwd: wt.path });
    execFileSync('git', ['commit', '-q', '-m', 'work'], { cwd: wt.path });
    await wm.remove(wt);
    assert.ok(!fs.existsSync(wt.path), 'worktree dir removed');
    let branchGone = false;
    try {
      execFileSync('git', ['rev-parse', '--verify', wt.branch], { cwd: repo });
    } catch {
      branchGone = true;
    }
    assert.ok(branchGone, 'branch deleted');
  });

  await check('worktree remove (uncommitted) force-cleans', async () => {
    const repo = initTempRepo();
    const wm = createWorktreeManager();
    const wt = await wm.setup(repo, 'bg_test3');
    fs.writeFileSync(path.join(wt.path, 'uncommitted.txt'), 'x');
    await wm.remove(wt);
    assert.ok(!fs.existsSync(wt.path), 'worktree dir removed (force)');
  });

  await check('delegation worktree mode creates + stops cleanly', async () => {
    const repo = initTempRepo();
    const wm = createWorktreeManager();
    const client = makeFakeClient();
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-store-'));
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: repo, repoDir: repo, worktreeManager: wm });
    const id = await bg.createDelegation({ prompt: 'write code', mode: 'worktree' });
    const state = bg._internals.readState(id);
    assert.strictEqual(state.mode, 'worktree', 'mode worktree');
    assert.ok(state.worktree && state.worktree.path, 'worktree recorded');
    assert.ok(fs.existsSync(state.worktree.path), 'worktree dir exists on disk');
    assert.strictEqual(state.directory, state.worktree.path, 'child directory is worktree path');
    await bg.stopDelegation(id);
    assert.ok(!fs.existsSync(state.worktree.path), 'worktree removed after stop');
    const after = bg._internals.readState(id);
    assert.strictEqual(after.state, 'cancelled', 'state cancelled');
  });

  await check('worktree mode requires manager + repoDir', async () => {
    const client = makeFakeClient();
    const bg = createBackgroundDelegate({ client, storeDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bg-x-')), directory: '/tmp' });
    let threw = false;
    try {
      await bg.createDelegation({ prompt: 'x', mode: 'worktree' });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'throws when worktreeManager/repoDir missing');
  });

  await check('failed worktree startup cleans up the worktree', async () => {
    const repo = initTempRepo();
    const wm = createWorktreeManager();
    const client = makeFakeClient();
    client.session.create = async () => { throw new Error('create rejected (simulated)'); };
    const store = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-store-'));
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: repo, repoDir: repo, worktreeManager: wm });
    let threw = false;
    try {
      await bg.createDelegation({ prompt: 'write code', mode: 'worktree' });
    } catch {
      threw = true;
    }
    assert.ok(threw, 'createDelegation throws when spawn fails');
    // The worktree was created during setup; it must be removed on spawn failure.
    const files = fs.readdirSync(store).filter((f) => f.endsWith('.json'));
    assert.strictEqual(files.length, 1, 'one delegation state recorded');
    const state = JSON.parse(fs.readFileSync(path.join(store, files[0]), 'utf-8'));
    assert.ok(state.worktree && state.worktree.path, 'worktree path recorded before failure');
    assert.ok(!fs.existsSync(state.worktree.path), 'worktree removed after failed startup');
    assert.strictEqual(state.state, 'error', 'delegation marked error');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((e) => {
  console.error('harness error:', e);
  process.exit(1);
});
