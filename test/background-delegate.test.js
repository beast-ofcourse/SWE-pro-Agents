'use strict';

/**
 * background-delegate.test.js — plain-node tests for scripts/background-delegate.js.
 * Uses a controllable fake in-process client that mimics the verified wrapped
 * contract (create/get return { data }, completion = tokens.output > 0).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBackgroundDelegate } = require('../scripts/background-delegate.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bg-test-'));
}

function makeFakeClient() {
  const sessions = {}; // childID -> { id, tokens:{output}, state, _result }
  let createCount = 0;
  let promptCount = 0;
  let abortCount = 0;

  return {
    _stats: () => ({ createCount, promptCount, abortCount }),
    _markComplete: (id, text) => {
      if (sessions[id]) {
        sessions[id].tokens.output = 5;
        sessions[id].state = 'completed';
        sessions[id]._result = text || 'CHILD RESULT';
      }
    },
    _injectSession: (id, session) => {
      sessions[id] = session;
    },
    session: {
      async create() {
        createCount += 1;
        const id = 'child_' + createCount;
        sessions[id] = { id, tokens: { output: 0 }, state: 'running', _result: '' };
        return { data: sessions[id] };
      },
      async prompt({ path }) {
        promptCount += 1;
        return Promise.resolve({ ok: true });
      },
      async get({ path }) {
        const s = sessions[path.id];
        return { data: s ? Object.assign({}, s) : { id: path.id, tokens: { output: 0 }, state: 'running' } };
      },
      async abort({ path }) {
        abortCount += 1;
        if (sessions[path.id]) sessions[path.id].state = 'cancelled';
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
      .catch((err) => {
        console.log('FAIL  ' + name + ': ' + err.message);
        failed += 1;
      });
  }

  // 1. Lifecycle: registered -> running -> completed, result captured.
  await check('lifecycle registered->running->completed', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'do work', agent: 'swe-x', title: 'T1' });
    let st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'running', 'should be running after create (slot free)');
    assert.ok(st.childSessionID, 'childSessionID should be set');

    client._markComplete(st.childSessionID, 'DONE RESULT');
    const result = await bg.readDelegation(id, 2000);
    assert.strictEqual(result, 'DONE RESULT', 'readDelegation should return child result');
    st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'completed', 'state should be completed after read');
    const md = fs.readFileSync(path.join(store, id + '.md'), 'utf-8');
    assert.strictEqual(md, 'DONE RESULT', 'markdown result file should match');
  });

  // 2. Terminal-state protection: finalize twice does not overwrite.
  await check('terminal-state protection', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'x' });
    const child = bg._internals.readState(id).childSessionID;
    client._markComplete(child, 'ORIGINAL');
    await bg.readDelegation(id, 2000);
    const after1 = await bg.finalizeDelegation(id, 'SHOULD NOT OVERWRITE');
    assert.strictEqual(after1.state, 'completed', 'still completed');
    const md = fs.readFileSync(path.join(store, id + '.md'), 'utf-8');
    assert.strictEqual(md, 'ORIGINAL', 'markdown must not be overwritten once terminal');
  });

  // 3. Blocking read timeout is bounded and deterministic.
  await check('readDelegation timeout bounded', async () => {
    const client = makeFakeClient(); // child never completes
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'x' });
    const t0 = Date.now();
    const res = await bg.readDelegation(id, 1200);
    const dt = Date.now() - t0;
    assert.strictEqual(res, 'timeout: still running', 'returns deterministic timeout info');
    assert.ok(dt < 2500, 'must not exceed timeoutMs significantly (dt=' + dt + ')');
  });

  // 4. listDelegations returns scanned delegations.
  await check('listDelegations', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id1 = await bg.createDelegation({ prompt: 'a', title: 'Alpha' });
    const id2 = await bg.createDelegation({ prompt: 'b', title: 'Beta' });
    const list = await bg.listDelegations();
    assert.strictEqual(list.length, 2, 'two delegations listed');
    const titles = list.map((l) => l.title).sort();
    assert.deepStrictEqual(titles, ['Alpha', 'Beta'], 'titles present');
  });

  // 5. stopDelegation cancels and aborts the child.
  await check('stopDelegation aborts child', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'x' });
    const res = await bg.stopDelegation(id);
    assert.strictEqual(res.state, 'cancelled', 'state cancelled');
    assert.strictEqual(client._stats().abortCount, 1, 'abort called once');
    const read = await bg.readDelegation(id, 500);
    assert.strictEqual(read, 'terminal: cancelled', 'read returns terminal info');
  });

  // 6. Concurrency limit: 5th queues until a slot frees.
  await check('concurrency limit enforces max parallel', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', env: { SWE_PRO_BG_MAX_PARALLEL: '4' } });
    const ids = [];
    for (let i = 0; i < 5; i += 1) ids.push(await bg.createDelegation({ prompt: 'x' + i }));
    assert.strictEqual(client._stats().createCount, 4, 'only 4 spawned (5th queued)');
    const fifth = bg._internals.readState(ids[4]);
    assert.strictEqual(fifth.state, 'registered', '5th stays registered (queued)');
    assert.strictEqual(fifth.childSessionID, null, '5th not yet spawned');

    // Free a slot -> 5th should spawn.
    await bg.finalizeDelegation(ids[0], 'done');
    assert.strictEqual(client._stats().createCount, 5, '5th spawned after dequeue');
    const fifthNow = bg._internals.readState(ids[4]);
    assert.strictEqual(fifthNow.state, 'running', '5th now running');
  });

  // 7. Priority queue: model-specified delegation jumps the queue.
  await check('priority queue orders by model>provider>default', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', env: { SWE_PRO_BG_MAX_PARALLEL: '1' } });
    const low = await bg.createDelegation({ prompt: 'low' }); // priority 0
    const high = await bg.createDelegation({ prompt: 'high', model: 'x' }); // priority 2
    // Only 1 slot: low spawned first (created first), high queued.
    assert.strictEqual(client._stats().createCount, 1, 'only low spawned (1 slot)');
    const highState = bg._internals.readState(high);
    assert.strictEqual(highState.state, 'registered', 'high queued');
    // Free slot -> high (priority 2) should spawn before any other default.
    await bg.finalizeDelegation(low, 'done');
    assert.strictEqual(client._stats().createCount, 2, 'high spawned after dequeue');
    const highNow = bg._internals.readState(high);
    assert.strictEqual(highNow.state, 'running', 'high priority ran next');
  });

  // 7b. Reconcile adopts orphans in priority order (highest first).
  await check('reconcileOrphans adopts highest-priority orphan first', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', env: { SWE_PRO_BG_MAX_PARALLEL: '1' } });
    const low = await bg.createDelegation({ prompt: 'low' });
    const high = await bg.createDelegation({ prompt: 'high', model: 'x' });
    const mid = await bg.createDelegation({ prompt: 'mid', provider: 'y' });
    // Simulate a crash: clear live runtime state, leave only registered orphans on disk.
    bg._internals.running.clear();
    bg._internals.queue.length = 0;
    for (const id of [low, high, mid]) {
      const st = bg._internals.readState(id);
      st.state = 'registered';
      st.childSessionID = null;
      bg._internals.writeState(st);
    }
    await bg.reconcileOrphans();
    // With 1 slot, the highest-priority orphan (high, p2) is adopted and started first.
    const highSt = bg._internals.readState(high);
    assert.strictEqual(highSt.state, 'running', 'highest-priority orphan adopted first');
    const midSt = bg._internals.readState(mid);
    assert.strictEqual(midSt.state, 'registered', 'mid still queued');
    // Free the slot -> mid (p1) should run next, not low (p0).
    await bg.finalizeDelegation(high, 'done');
    const midNow = bg._internals.readState(mid);
    assert.strictEqual(midNow.state, 'running', 'mid (p1) adopted before low (p0)');
  });

  // 8. Orphan re-adoption: a registered/running delegation whose child completed
  //     is finalized on reconcile.
  await check('reconcileOrphans finalizes completed child', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'x' });
    const child = bg._internals.readState(id).childSessionID;
    client._markComplete(child, 'RECONCILED');
    await bg.reconcileOrphans();
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'completed', 'orphan finalized by reconcile');
    const md = fs.readFileSync(path.join(store, id + '.md'), 'utf-8');
    assert.strictEqual(md, 'RECONCILED', 'reconciled result written');
  });

  // 9. Store dir created with 0700 (mode asserted on non-Windows).
  await check('store dir 0700 perms', async () => {
    const client = makeFakeClient();
    const store = path.join(tmpDir(), 'nested', 'delegations');
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    await bg.createDelegation({ prompt: 'x' });
    assert.ok(fs.existsSync(store), 'store dir exists');
    if (process.platform !== 'win32') {
      const mode = fs.statSync(store).mode & 0o777;
      assert.strictEqual(mode, 0o700, 'store dir perms should be 0700 (got ' + mode.toString(8) + ')');
    }
  });

  // 10. Retention: pruneDelegations removes only old terminal delegations.
  await check('pruneDelegations retention', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const old = await bg.createDelegation({ prompt: 'old' });
    const fresh = await bg.createDelegation({ prompt: 'fresh' });
    // writeState always bumps updatedAt, so backdate by writing the file directly
    // (simulating a delegation last touched 40 days ago).
    const oldState = bg._internals.readState(old);
    oldState.state = 'completed';
    oldState.updatedAt = Date.now() - 40 * 24 * 60 * 60 * 1000;
    fs.writeFileSync(path.join(store, old + '.json'), JSON.stringify(oldState, null, 2));
    // `fresh` stays terminal with updatedAt = now (not pruned).
    const freshState = bg._internals.readState(fresh);
    freshState.state = 'completed';
    bg._internals.writeState(freshState);
    const removed = await bg.pruneDelegations(30);
    assert.strictEqual(removed, 1, 'only the old delegation should be pruned');
    assert.ok(!fs.existsSync(path.join(store, old + '.json')), 'old state removed');
    assert.ok(fs.existsSync(path.join(store, fresh + '.json')), 'fresh state kept');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
