'use strict';

/**
 * background-delegate.test.js — plain-node tests for the delegation engine
 * inlined in plugins/swe-pro-agents.js. Uses a controllable fake in-process
 * client that mimics the verified wrapped contract (create/get return { data },
 * completion = tokens.output > 0).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBackgroundDelegate } = require('../plugins/swe-pro-agents.js');
const { createJournal } = require('../scripts/background-journal.js');
const { registerSchema, validateResult } = require('../scripts/background-results.js');

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
    // T-004 extended state shape.
    assert.strictEqual(st.heartbeatAt, null, 'heartbeatAt is null at creation');
    assert.ok(st.journalPath, 'journalPath should be set');
    assert.ok(fs.existsSync(st.journalPath), 'journal file should exist after registered event');
    assert.ok(fs.readFileSync(st.journalPath, 'utf-8').includes('registered'), 'journal should contain a registered line');
    // T-004 parent.children wiring.
    const parent = await bg.createDelegation({ prompt: 'parent work', title: 'PARENT' });
    const child = await bg.createDelegation({ prompt: 'child work', title: 'CHILD', parentID: parent });
    const parentState = bg._internals.readState(parent);
    assert.ok(parentState.children.includes(child), 'parent children should include the child id');
    const childState = bg._internals.readState(child);
    assert.strictEqual(childState.heartbeatAt, null, 'child heartbeatAt is null at creation');
    assert.ok(childState.journalPath, 'child journalPath should be set');
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

  // T-010 (1) terminal state with zero tokens -> completed (no token heuristic).
  await check('T-010 terminal state tokens 0 -> completed', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'completed', tokens: { output: 0 }, lastActivityAt: null }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x' });
    await bg.readDelegation(id, 2000);
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'completed', 'terminal state with zero tokens must complete');
  });

  // T-010 (2) recent lastActivityAt past staleTimeoutMs -> still running (no false interrupt).
  await check('T-010 recent activity past stale stays running', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { output: 0 }, lastActivityAt: Date.now() }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', staleTimeoutMs: 50 });
    await new Promise((r) => setTimeout(r, 150));
    const res = await bg.readDelegation(id, 800);
    assert.strictEqual(res, 'timeout: still running', 'fresh activity must not interrupt');
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'running', 'delegation stays running');
  });

  // Heartbeat refresh persists a tokens snapshot for dashboard observability.
  await check('heartbeat refresh stores tokens snapshot', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { input: 12, output: 34 }, lastActivityAt: Date.now() }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', staleTimeoutMs: 60000, ttlMs: 60000 });
    await bg.readDelegation(id, 1500);
    const st = bg._internals.readState(id);
    assert.deepStrictEqual(st.tokens, { input: 12, output: 34 }, 'tokens snapshot persisted (got ' + JSON.stringify(st.tokens) + ')');
  });

  // T-010 (3) old lastActivityAt -> interrupt with reason stale.
  await check('T-010 old activity -> interrupt stale', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const old = Date.now() - 100000;
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { output: 0 }, lastActivityAt: old }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', staleTimeoutMs: 1000 });
    const res = await bg.readDelegation(id, 2000);
    assert.ok(res.indexOf('terminal: interrupt') === 0, 'should return terminal interrupt (got ' + res + ')');
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'interrupt', 'state should be interrupt');
    assert.strictEqual(st.interruptReason, 'stale', 'reason should be stale');
  });

  // T-010 (4) getActivity returns gone -> error session_gone.
  await check('T-010 gone -> error session_gone', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'gone', lastActivityAt: null }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x' });
    const res = await bg.readDelegation(id, 2000);
    assert.ok(res.indexOf('terminal: error') === 0, 'should return terminal error (got ' + res + ')');
    assert.ok(res.includes('session_gone'), 'should name session_gone (got ' + res + ')');
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'error', 'state should be error');
    assert.strictEqual(st.summary, 'session_gone', 'summary should be session_gone');
  });

  // T-010 (5) scheduled past admissionTimeoutMs -> error admission_failed.
  await check('T-010 scheduled past admission -> error admission_failed', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { output: 0 }, lastActivityAt: Date.now() }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', admissionTimeoutMs: 100 });
    const scheduled = bg._internals.readState(id);
    scheduled.state = 'scheduled';
    scheduled.childSessionID = null;
    scheduled.createdAt = Date.now() - 10000;
    bg._internals.writeState(scheduled);
    bg._internals.running.delete(id);
    const res = await bg.readDelegation(id, 2000);
    assert.ok(res.indexOf('terminal: error') === 0, 'should return terminal error (got ' + res + ')');
    assert.ok(res.includes('admission_failed'), 'should name admission_failed (got ' + res + ')');
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'error', 'state should be error');
    assert.strictEqual(st.summary, 'admission_failed', 'summary should be admission_failed');
  });

  // T-011 (1) depth guard rejects when parent already at maxDepth.
  await check('T-011 depth guard rejects', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const parent = await bg.createDelegation({ prompt: 'parent' });
    assert.strictEqual(bg._internals.readState(parent).depth, 1, 'parent depth should be 1');
    const child = await bg.createDelegation({ prompt: 'child', parentID: parent });
    assert.strictEqual(bg._internals.readState(child).depth, 2, 'child depth should be parentDepth + 1');
    let threw = null;
    try {
      await bg.createDelegation({ prompt: 'grandchild', parentID: child });
    } catch (err) {
      threw = err;
    }
    assert.ok(threw, 'grandchild creation should throw');
    assert.ok(threw.message.includes('maxDepth exceeded'), 'should throw maxDepth exceeded (got ' + (threw && threw.message) + ')');
  });

  // T-011 (2) capability breach -> error: capability_breach.
  await check('T-011 capability breach -> error', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { input: 6, output: 6 }, lastActivityAt: Date.now() }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', capabilities: { maxTokens: 10 } });
    await bg.reconcileOrphans();
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'error', 'state should be error after breach');
    assert.strictEqual(st.summary, 'capability_breach', 'summary should be capability_breach');
    assert.strictEqual(client._stats().abortCount, 1, 'child should be aborted');
  });

  // M1: budget-only cap (no capabilities manifest) is enforced like a manifest.
  await check('M1 budget-only maxTokens enforced', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { input: 60, output: 40 }, lastActivityAt: Date.now() }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', maxTokens: 10 });
    await bg.reconcileOrphans();
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'error', 'state should be error after budget breach');
    assert.strictEqual(st.summary, 'capability_breach', 'summary should be capability_breach');
    assert.strictEqual(client._stats().abortCount, 1, 'child should be aborted');
  });

  // Review M1: bg_delegate passes a SESSION id as parentID — it must resolve
  // via childSessionID match for depth + children wiring.
  await check('M1-review session-id parent resolves depth + children', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const parent = await bg.createDelegation({ prompt: 'parent' });
    const parentState = bg._internals.readState(parent);
    assert.ok(parentState.childSessionID, 'parent should have a child session');
    const child = await bg.createDelegation({ prompt: 'child', parentID: parentState.childSessionID });
    assert.strictEqual(bg._internals.readState(child).depth, 2, 'session-id parent should yield depth 2');
    assert.ok(bg._internals.readState(parent).children.includes(child), 'parent.children should include the child');
  });

  // Review M1: an unresolvable parentID starts a depth-1 root (no phantom depth).
  await check('M1-review unresolved parent starts depth-1 root', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'orphan', parentID: 'sess_ghost' });
    assert.strictEqual(bg._internals.readState(id).depth, 1, 'unresolved parent should yield depth 1');
  });

  // Review M2: stopping a completed delegation preserves it (no abort rewrite,
  // no worktree removal, no bogus cancelled line).
  await check('M2-review stop preserves completed state + worktree', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const worktreeRoot = tmpDir();
    let removeCalls = 0;
    const fakeWorktreeManager = {
      setup: async (repoDir, id) => {
        const wtPath = path.join(worktreeRoot, String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
        fs.mkdirSync(wtPath, { recursive: true });
        return { path: wtPath, branch: 'bg-' + id, repoDir };
      },
      remove: async (worktree) => {
        removeCalls += 1;
        fs.rmSync(worktree.path, { recursive: true, force: true });
      },
    };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', repoDir: worktreeRoot, worktreeManager: fakeWorktreeManager });
    const id = await bg.createDelegation({ prompt: 'x', mode: 'worktree' });
    await bg.finalizeDelegation(id, 'done result');
    const wtPath = bg._internals.readState(id).worktree.path;
    await bg.stopDelegation(id);
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'completed', 'completed must survive stop (got ' + st.state + ')');
    assert.strictEqual(removeCalls, 0, 'worktree must not be removed');
    assert.ok(fs.existsSync(wtPath), 'worktree path must remain on disk');
  });

  // Review M2: a child that completes during the breach await keeps its outcome.
  // (Flips running states on EVERY poll: the spawn-success token estimate also
  // polls getActivity during creation, so a flip-once fake would fire too early
  // and be overwritten by the in-flight creation.)
  await check('M2-review enforce preserves completed race winner', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = {
      getActivity: async () => {
        for (const f of fs.readdirSync(store).filter((x) => x.endsWith('.json'))) {
          const p = path.join(store, f);
          const s = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (s.state === 'running') {
            s.state = 'completed';
            s.summary = 'done ok';
            fs.writeFileSync(p, JSON.stringify(s, null, 2));
          }
        }
        return { state: 'running', tokens: { input: 60, output: 40 }, lastActivityAt: Date.now() };
      },
    };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', capabilities: { maxTokens: 10 } });
    await bg.reconcileOrphans();
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'completed', 'completed race winner must survive enforce (got ' + st.state + ')');
    assert.strictEqual(st.summary, 'done ok', 'summary must not become capability_breach');
  });

  // Review M3: a truly queued delegation (registered, no child) hits admission timeout.
  await check('M3-review queued registered hits admission timeout', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { output: 0 }, lastActivityAt: Date.now() }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    for (let i = 0; i < 4; i += 1) {
      await bg.createDelegation({ prompt: 'filler-' + i });
    }
    const queued = await bg.createDelegation({ prompt: 'queued', admissionTimeoutMs: 100 });
    const fresh = await bg.createDelegation({ prompt: 'fresh-queued' });
    const queuedState = bg._internals.readState(queued);
    assert.strictEqual(queuedState.state, 'registered', 'over-capacity delegation should queue as registered');
    assert.strictEqual(queuedState.childSessionID, null, 'queued delegation should have no child');
    await new Promise((r) => setTimeout(r, 200));
    await bg.reconcileOrphans();
    const q = bg._internals.readState(queued);
    assert.strictEqual(q.state, 'error', 'expired queued delegation should be error');
    assert.strictEqual(q.summary, 'admission_failed', 'summary should be admission_failed');
    // The freed capacity may admit the fresh task (it starts) or leave it
    // queued — either way it must stay alive, never fail spuriously.
    const freshState = bg._internals.readState(fresh).state;
    assert.ok(freshState === 'registered' || freshState === 'running', 'fresh queued delegation must stay alive (got ' + freshState + ')');
  });

  // m1: one poisoned orphan must not abort the supervisor pass for the rest.
  await check('m1 reconcile survives one orphan start failure', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const old = Date.now() - 100000;
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { output: 0 }, lastActivityAt: old }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const poisoned = await bg.createDelegation({ prompt: 'poison', staleTimeoutMs: 1000 });
    const stale = await bg.createDelegation({ prompt: 'stale', staleTimeoutMs: 1000 });
    // Simulate a restart: disk state remains, in-memory running set is empty.
    bg._internals.running.delete(poisoned);
    bg._internals.running.delete(stale);
    const ps = bg._internals.readState(poisoned);
    ps.state = 'registered';
    ps.childSessionID = null;
    bg._internals.writeState(ps);
    // Every future spawn fails (e.g. sustained 429 storm).
    client.session.create = async () => { throw new Error('boom-429'); };
    await bg.reconcileOrphans();
    const a = bg._internals.readState(poisoned);
    assert.strictEqual(a.state, 'error', 'poisoned orphan should be error (got ' + a.state + ')');
    assert.strictEqual(a.summary, 'failed to start', 'poisoned summary should be failed to start (got ' + a.summary + ')');
    const b = bg._internals.readState(stale);
    assert.strictEqual(b.state, 'interrupt', 'stale orphan should still be interrupted (got ' + b.state + ')');
    assert.strictEqual(b.interruptReason, 'stale', 'interrupt reason should be stale');
  });

  // T-012 (1) cascade stops 2 children via populated parent.children.
  await check('T-012 cascade stops 2 children', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const parent = await bg.createDelegation({ prompt: 'parent' });
    const child1 = await bg.createDelegation({ prompt: 'c1', parentID: parent });
    const child2 = await bg.createDelegation({ prompt: 'c2', parentID: parent });
    const parentState = bg._internals.readState(parent);
    assert.deepStrictEqual(parentState.children.slice().sort(), [child1, child2].sort(), 'parent.children should hold both child ids');
    const abortsBefore = client._stats().abortCount;
    await bg.stopDelegation(parent);
    assert.strictEqual(bg._internals.readState(parent).state, 'cancelled', 'parent should be cancelled');
    assert.strictEqual(bg._internals.readState(child1).state, 'cancelled', 'child1 should be cascade-cancelled');
    assert.strictEqual(bg._internals.readState(child2).state, 'cancelled', 'child2 should be cascade-cancelled');
    assert.strictEqual(client._stats().abortCount, abortsBefore + 3, 'parent + 2 children aborted');
    assert.strictEqual(bg._internals.readState(child1).cancelSignal, 'hard', 'default signal should be hard');
  });

  // T-012 (2) keep:true leaves worktree path on disk (fake worktreeManager).
  await check('T-012 keep:true leaves worktree on disk', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const worktreeRoot = tmpDir();
    let removeCalls = 0;
    const fakeWorktreeManager = {
      setup: async (repoDir, id) => {
        const wtPath = path.join(worktreeRoot, String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
        fs.mkdirSync(wtPath, { recursive: true });
        fs.writeFileSync(path.join(wtPath, 'marker.txt'), 'work');
        return { path: wtPath, branch: 'bg-' + id, repoDir };
      },
      remove: async (worktree) => {
        removeCalls += 1;
        fs.rmSync(worktree.path, { recursive: true, force: true });
      },
    };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', repoDir: worktreeRoot, worktreeManager: fakeWorktreeManager });
    const id = await bg.createDelegation({ prompt: 'x', mode: 'worktree' });
    const st = bg._internals.readState(id);
    assert.ok(st.worktree && st.worktree.path, 'worktree path should be recorded');
    assert.ok(fs.existsSync(st.worktree.path), 'worktree should exist before stop');
    await bg.stopDelegation(id, { signal: 'hard', keep: true });
    assert.ok(fs.existsSync(st.worktree.path), 'keep:true must leave the worktree on disk');
    assert.strictEqual(removeCalls, 0, 'worktreeManager.remove must not be called');
    assert.strictEqual(bg._internals.readState(id).state, 'cancelled', 'delegation still cancelled');
  });

  // T-013 redaction on persist: secrets masked in state, journal, and markdown.
  await check('T-013 redaction on persist', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'x', title: 'api_key=SECRET' });
    const st = bg._internals.readState(id);
    assert.ok(!st.title.includes('SECRET') && st.title.includes('<redacted>'), 'title must be redacted (got ' + st.title + ')');
    const journalText = fs.readFileSync(path.join(store, id + '.journal.jsonl'), 'utf-8');
    assert.ok(journalText.includes('<redacted>') && !journalText.includes('SECRET'), 'journal must mask the secret');
    await bg.finalizeDelegation(id, 'result api_key=SECRET');
    const md = fs.readFileSync(path.join(store, id + '.md'), 'utf-8');
    assert.ok(md.includes('<redacted>') && !md.includes('SECRET'), 'markdown must mask the secret');
  });

  // T-014 supervisor liveness + single-flight: concurrent reconciles finalize once.
  await check('T-014 concurrent reconcile single-flight interrupt once', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const old = Date.now() - 100000;
    const spawner = { getActivity: async () => ({ state: 'running', tokens: { output: 0 }, lastActivityAt: old }) };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', spawner });
    const id = await bg.createDelegation({ prompt: 'x', staleTimeoutMs: 1000 });
    await Promise.all([bg.reconcileOrphans(), bg.reconcileOrphans()]);
    const st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'interrupt', 'state should be interrupt');
    const lines = fs.readFileSync(path.join(store, id + '.journal.jsonl'), 'utf-8').trim().split('\n');
    const interrupts = lines.filter((line) => {
      try {
        return JSON.parse(line).type === 'interrupt';
      } catch {
        return false;
      }
    });
    assert.strictEqual(interrupts.length, 1, 'exactly one journal interrupt line (got ' + interrupts.length + ')');
  });

  // T-020 journal every transition: full lifecycle journals 3 events.
  await check('T-020 full lifecycle journals every transition', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'x', title: 'T-020' });
    const child = bg._internals.readState(id).childSessionID;
    client._markComplete(child, 'T-020 RESULT');
    await bg.readDelegation(id, 2000);
    // Counted from the implementation: createDelegation journals `registered`,
    // startDelegation journals `running`, finalizeDelegation journals `completed` = 3.
    const events = createJournal({ storeDir: store }).replay(id);
    assert.strictEqual(events.length, 3, 'full lifecycle should journal 3 transitions (got ' + events.length + ')');
    assert.deepStrictEqual(events.map((e) => e.type), ['registered', 'running', 'completed'], 'journal order should follow the lifecycle');
  });

  // T-025 bg_prune prunes terminal state (30d) AND journal (7d independently).
  await check('T-025 bg_prune prunes state 30d and journal 7d', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const DAY = 24 * 60 * 60 * 1000;
    // Backdate every journal line (no real waits): journal.prune keys off the
    // newest event timestamp, not file mtime.
    function backdateJournal(id, ageMs) {
      const journalFile = path.join(store, id + '.journal.jsonl');
      const lines = fs.readFileSync(journalFile, 'utf-8').trim().split('\n');
      const old = Date.now() - ageMs;
      fs.writeFileSync(journalFile, lines.map((line) => {
        const ev = JSON.parse(line);
        ev.t = old;
        return JSON.stringify(ev);
      }).join('\n') + '\n');
    }
    // Case 1: 40d-old state + 10d-old journal -> prune removes state AND journal.
    const old = await bg.createDelegation({ prompt: 'old' });
    await bg.finalizeDelegation(old, 'old result');
    const oldState = bg._internals.readState(old);
    oldState.updatedAt = Date.now() - 40 * DAY;
    fs.writeFileSync(path.join(store, old + '.json'), JSON.stringify(oldState, null, 2));
    backdateJournal(old, 10 * DAY);
    // Case 2 (acceptance): 10d-old terminal keeps state, loses journal.
    const mid = await bg.createDelegation({ prompt: 'mid' });
    await bg.finalizeDelegation(mid, 'mid result');
    const midState = bg._internals.readState(mid);
    midState.updatedAt = Date.now() - 10 * DAY;
    fs.writeFileSync(path.join(store, mid + '.json'), JSON.stringify(midState, null, 2));
    backdateJournal(mid, 10 * DAY);
    // Case 3: 40d-old interrupt is terminal too — pruned like other terminals.
    const intr = await bg.createDelegation({ prompt: 'intr' });
    await bg.finalizeDelegation(intr, 'intr result');
    const intrState = bg._internals.readState(intr);
    intrState.state = 'interrupt';
    intrState.interruptReason = 'stale';
    intrState.updatedAt = Date.now() - 40 * DAY;
    fs.writeFileSync(path.join(store, intr + '.json'), JSON.stringify(intrState, null, 2));
    backdateJournal(intr, 10 * DAY);
    const removed = await bg.pruneDelegations(30);
    assert.strictEqual(removed, 2, 'the 40d completed + 40d interrupt states should be pruned (got ' + removed + ')');
    assert.ok(!fs.existsSync(path.join(store, old + '.json')), 'old state removed');
    assert.ok(!fs.existsSync(path.join(store, old + '.journal.jsonl')), 'old journal removed');
    assert.ok(!fs.existsSync(path.join(store, intr + '.json')), 'old interrupt state removed');
    assert.ok(!fs.existsSync(path.join(store, intr + '.journal.jsonl')), 'old interrupt journal removed');
    assert.ok(fs.existsSync(path.join(store, mid + '.json')), '10d-old terminal keeps state');
    assert.ok(!fs.existsSync(path.join(store, mid + '.journal.jsonl')), '10d-old terminal loses journal');
  });

  // T-023 (1) retry-then-quarantine reuses the same worktree path across retries.
  await check('T-023 retry then quarantine reuses worktree path', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const worktreeRoot = tmpDir();
    let setupCalls = 0;
    const fakeWorktreeManager = {
      setup: async (repoDir, id) => {
        setupCalls += 1;
        const wtPath = path.join(worktreeRoot, String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
        fs.mkdirSync(wtPath, { recursive: true });
        return { path: wtPath, branch: 'bg-' + id, repoDir };
      },
      remove: async (worktree) => {
        fs.rmSync(worktree.path, { recursive: true, force: true });
      },
    };
    // Default retry budget is 2: two auto-retries, then quarantine.
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', repoDir: worktreeRoot, worktreeManager: fakeWorktreeManager });
    const id = await bg.createDelegation({ prompt: 'x', mode: 'worktree' });
    const first = bg._internals.readState(id);
    assert.strictEqual(first.state, 'running', 'starts running');
    const worktreePath = first.worktree.path;
    assert.ok(worktreePath, 'worktree path should be recorded');
    assert.strictEqual(setupCalls, 1, 'setup called once at creation');

    async function failDelegation() {
      const st = bg._internals.readState(id);
      st.state = 'error';
      st.summary = 'boom';
      bg._internals.writeState(st);
    }
    const retryLines = () => createJournal({ storeDir: store }).replay(id).filter((e) => e.type === 'retry').length;

    await failDelegation();
    await bg.reconcileOrphans();
    let st = bg._internals.readState(id);
    assert.strictEqual(st.retryCount, 1, 'first failure retries (retryCount 1)');
    assert.strictEqual(st.state, 'running', 'retried delegation restarts');
    assert.strictEqual(st.worktree.path, worktreePath, 'worktree path reused on retry');
    assert.strictEqual(setupCalls, 1, 'no new worktree on retry');

    await failDelegation();
    await bg.reconcileOrphans();
    st = bg._internals.readState(id);
    assert.strictEqual(st.retryCount, 2, 'second failure retries (retryCount 2)');
    assert.strictEqual(st.state, 'running', 'retried delegation restarts again');
    assert.strictEqual(st.worktree.path, worktreePath, 'worktree path still reused');
    assert.strictEqual(setupCalls, 1, 'still no new worktree');
    assert.strictEqual(retryLines(), 2, 'two retry journal lines (got ' + retryLines() + ')');

    await failDelegation();
    await bg.reconcileOrphans();
    st = bg._internals.readState(id);
    assert.strictEqual(st.state, 'error', 'over budget stays error');
    assert.strictEqual(st.quarantined, true, 'over budget quarantines');
    assert.strictEqual(st.worktree.path, worktreePath, 'quarantine keeps the worktree path');
    assert.strictEqual(setupCalls, 1, 'quarantine creates no worktree');
    const types = createJournal({ storeDir: store }).replay(id).map((e) => e.type);
    assert.ok(types.includes('quarantined'), 'quarantined journal line present');

    // Quarantined tasks are never auto-retried: further reconciles are no-ops.
    const createsBefore = client._stats().createCount;
    await bg.reconcileOrphans();
    assert.strictEqual(client._stats().createCount, createsBefore, 'no new spawn after quarantine');
    assert.strictEqual(retryLines(), 2, 'no new retry line after quarantine');
    assert.strictEqual(bg._internals.readState(id).quarantined, true, 'still quarantined');
  });

  // T-030 (1) known agent -> typed result (schemas via deps injection, so the
  // shared plugin registry is never mutated; uniquely-named fake agent).
  await check('T-030 typed result for known agent', async () => {
    registerSchema('t030-typed-agent', (raw) => ({ ok: true, value: { echo: String(raw) } }));
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', validateResult });
    const id = await bg.createDelegation({ prompt: 'x', agent: 't030-typed-agent' });
    const child = bg._internals.readState(id).childSessionID;
    client._markComplete(child, 'TYPED OUTPUT');
    await bg.readDelegation(id, 2000);
    const st = bg._internals.readState(id);
    assert.strictEqual(st.result && st.result.kind, 'typed', 'known agent should persist a typed result (got ' + JSON.stringify(st.result) + ')');
  });

  // T-030 (2) unknown agent -> generic result, bg_read still readable text.
  await check('T-030 generic result for unknown agent', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', validateResult });
    const id = await bg.createDelegation({ prompt: 'x', agent: 't030-unknown-agent' });
    const child = bg._internals.readState(id).childSessionID;
    client._markComplete(child, 'GENERIC OUTPUT');
    const text = await bg.readDelegation(id, 2000);
    assert.strictEqual(text, 'GENERIC OUTPUT', 'bg_read should still return readable text (got ' + text + ')');
    const st = bg._internals.readState(id);
    assert.strictEqual(st.result && st.result.kind, 'generic', 'unknown agent should persist a generic result (got ' + JSON.stringify(st.result) + ')');
  });

  // T-030 (3) streaming callback receives a partial string from fetchChildResult.
  await check('T-030 streaming callback receives partial string', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'x' });
    const child = bg._internals.readState(id).childSessionID;
    // Seed a partial without completing: messages() returns it while get()
    // still reports running, so the read keeps polling (and streaming).
    client._injectSession(child, { id: child, tokens: { output: 0 }, state: 'running', _result: 'PARTIAL TEXT' });
    const partials = [];
    const res = await bg.readDelegation(id, 1200, (partial) => { partials.push(partial); });
    assert.strictEqual(res, 'timeout: still running', 'streaming read still times out deterministically (got ' + res + ')');
    assert.ok(partials.length >= 1, 'streaming callback should fire at least once');
    assert.ok(partials.some((p) => typeof p === 'string' && p.indexOf('PARTIAL TEXT') !== -1), 'streaming callback should receive the partial string (got ' + JSON.stringify(partials) + ')');
  });

  // T-031 resume: errored + quarantined worktree delegation resumes in place
  // (path reused, quarantine cleared, [Resume context] injected); readonly
  // delegation returns cannot_resume: no_worktree.
  await check('T-031 resume quarantined worktree reuses path; readonly cannot_resume', async () => {
    const client = makeFakeClient();
    // Capture child prompt bodies to verify the [Resume context] injection.
    const childPrompts = [];
    const innerPrompt = client.session.prompt;
    client.session.prompt = async (args) => {
      try {
        const parts = args && args.body && args.body.parts;
        if (Array.isArray(parts)) childPrompts.push(parts.map((p) => p.text).join('\n'));
      } catch {
        /* capture never breaks the fake */
      }
      return innerPrompt(args);
    };
    const store = tmpDir();
    const worktreeRoot = tmpDir();
    let setupCalls = 0;
    const fakeWorktreeManager = {
      setup: async (repoDir, id) => {
        setupCalls += 1;
        const wtPath = path.join(worktreeRoot, String(id).replace(/[^a-zA-Z0-9_-]/g, ''));
        fs.mkdirSync(wtPath, { recursive: true });
        return { path: wtPath, branch: 'bg-' + id, repoDir };
      },
      remove: async (worktree) => {
        fs.rmSync(worktree.path, { recursive: true, force: true });
      },
    };
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp', repoDir: worktreeRoot, worktreeManager: fakeWorktreeManager });
    const id = await bg.createDelegation({ prompt: 'fix the bug', mode: 'worktree', title: 'T-031' });
    const before = bg._internals.readState(id);
    assert.strictEqual(before.prompt, 'fix the bug', 'original prompt must persist in state');
    const worktreePath = before.worktree.path;
    assert.ok(worktreePath, 'worktree path should be recorded');
    assert.strictEqual(setupCalls, 1, 'setup called once at creation');
    childPrompts.length = 0;
    // Journal a partial summary, then force an errored + quarantined state
    // (simulating the T-023 over-budget quarantine path).
    createJournal({ storeDir: store }).append(id, 'error', { summary: 'half-fixed: parser done' });
    const failed = bg._internals.readState(id);
    failed.state = 'error';
    failed.summary = 'boom';
    failed.quarantined = true;
    failed.retryCount = 2;
    bg._internals.writeState(failed);

    const resumed = await bg.resumeDelegation(id);
    assert.strictEqual(resumed.state, 'running', 'resume must return the running delegation');
    assert.ok(resumed.childSessionID, 'resume must spawn a new child');
    assert.notStrictEqual(resumed.childSessionID, before.childSessionID, 'resumed child must be new');
    assert.strictEqual(resumed.worktree.path, worktreePath, 'worktree path must be reused');
    assert.strictEqual(resumed.quarantined, false, 'quarantine must be cleared');
    assert.strictEqual(resumed.retryCount, 0, 'retryCount must reset');
    assert.strictEqual(resumed.heartbeatAt, null, 'heartbeatAt must reset');
    assert.strictEqual(resumed.prompt, 'fix the bug', 'stored prompt must stay the verbatim original');
    assert.strictEqual(setupCalls, 1, 'no new worktree on resume');
    assert.ok(childPrompts.length >= 1, 'resumed child must be prompted');
    const lastPrompt = childPrompts[childPrompts.length - 1];
    assert.ok(lastPrompt.includes('fix the bug'), 'resume prompt must carry the original prompt');
    assert.ok(lastPrompt.includes('[Resume context]'), 'resume prompt must carry resume context');
    assert.ok(lastPrompt.includes('half-fixed: parser done'), 'resume context must carry the last journal summary');
    const types = createJournal({ storeDir: store }).replay(id).map((e) => e.type);
    assert.ok(types.includes('resume'), 'resume journal line present');

    // Readonly delegations cannot resume (no worktree).
    const readonly = await bg.createDelegation({ prompt: 'research', title: 'RO' });
    const refused = await bg.resumeDelegation(readonly);
    assert.strictEqual(refused.cannot_resume, 'no_worktree', 'readonly must return cannot_resume: no_worktree (got ' + JSON.stringify(refused) + ')');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
