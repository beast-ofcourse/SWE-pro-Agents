'use strict';

/**
 * background-dashboard.test.js — plain-node tests for T-032 observability:
 * scripts/background-dashboard.js views (renderTree/toJson) plus the engine
 * per-task log (logPath/logEvent, transition hook, streaming partials).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderTree, toJson } = require('../scripts/background-dashboard.js');
const { createBackgroundDelegate } = require('../plugins/swe-pro-agents.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bg-dash-'));
}

function makeFakeClient() {
  const sessions = {}; // childID -> { id, tokens:{output}, state, _result, _partial }
  let createCount = 0;
  return {
    _markComplete: (id, text) => {
      if (sessions[id]) {
        sessions[id].tokens.output = 5;
        sessions[id].state = 'completed';
        sessions[id]._result = text || 'CHILD RESULT';
      }
    },
    _setPartial: (id, text) => {
      if (sessions[id]) sessions[id]._partial = text;
    },
    session: {
      async create() {
        createCount += 1;
        const id = 'child_' + createCount;
        sessions[id] = { id, tokens: { output: 0 }, state: 'running', _result: '', _partial: '' };
        return { data: sessions[id] };
      },
      async prompt() {
        return Promise.resolve({ ok: true });
      },
      async get({ path: route }) {
        const s = sessions[route.id];
        return { data: s ? Object.assign({}, s) : { id: route.id, tokens: { output: 0 }, state: 'running' } };
      },
      async abort({ path: route }) {
        if (sessions[route.id]) sessions[route.id].state = 'cancelled';
        return { ok: true };
      },
      async messages({ path: route }) {
        const s = sessions[route.id];
        if (s && s._partial) return { data: [{ role: 'assistant', content: s._partial }] };
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

  await check('renderTree prints exactly `no active delegations` on empty', async () => {
    assert.strictEqual(renderTree([]), 'no active delegations', 'empty list');
    assert.strictEqual(renderTree(null), 'no active delegations', 'null input never throws');
    assert.strictEqual(renderTree(undefined), 'no active delegations', 'undefined input never throws');
  });

  await check('renderTree line carries id, state, agent, branch, tokens, age', async () => {
    const tree = renderTree([{
      id: 'bg_abc', state: 'running', agent: 'swe-impl',
      branch: 'bg-work', tokens: { input: 10, output: 20 },
      createdAt: Date.now() - 65000,
    }]);
    assert.ok(tree.includes('bg_abc'), 'id present: ' + tree);
    assert.ok(tree.includes('running'), 'state present: ' + tree);
    assert.ok(tree.includes('swe-impl'), 'agent present: ' + tree);
    assert.ok(tree.includes('bg-work'), 'branch present: ' + tree);
    assert.ok(tree.includes('30'), 'tokens summed (10+20): ' + tree);
    assert.ok(/age:\S+/.test(tree), 'age present: ' + tree);
  });

  await check('renderTree never throws on partial state', async () => {
    const tree = renderTree([{ id: 'bg_lonely' }]);
    assert.ok(tree.includes('bg_lonely'), 'id survives: ' + tree);
    assert.ok(tree.includes('[unknown]'), 'missing state degrades: ' + tree);
    const multi = renderTree([{ id: 'bg_a', state: 'running' }, null, { state: 'completed' }]);
    assert.ok(multi.includes('bg_a'), 'first item: ' + multi);
    assert.ok(multi.includes('unknown'), 'null/partial items degrade: ' + multi);
  });

  await check('toJson preserves items and adds logPath per item', async () => {
    const store = tmpDir();
    const out = toJson([{ id: 'bg_1', state: 'running', agent: 'swe-x' }], store);
    assert.ok(Array.isArray(out), 'array out');
    assert.strictEqual(out.length, 1, 'one item');
    assert.strictEqual(out[0].state, 'running', 'fields preserved');
    assert.strictEqual(out[0].agent, 'swe-x', 'fields preserved');
    assert.strictEqual(out[0].logPath, path.join(store, 'bg_1.log'), 'logPath is <storeDir>/<id>.log');
    assert.deepStrictEqual(toJson([], store), [], 'empty list maps to empty array');
    assert.deepStrictEqual(toJson(null, store), [], 'null input never throws');
  });

  await check('each transition appends a line to <id>.log', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'do work', agent: 'swe-x', title: 'T-log' });
    const st = bg._internals.readState(id);
    client._markComplete(st.childSessionID, 'DONE RESULT');
    await bg.readDelegation(id, 2000);
    assert.strictEqual(bg.logPath(id), path.join(store, id + '.log'), 'logPath resolves under the store dir');
    const logText = fs.readFileSync(bg.logPath(id), 'utf-8');
    const lines = logText.trim().split('\n');
    assert.ok(lines.length >= 3, 'registered + running + completed lines, got ' + lines.length + ': ' + logText);
    assert.ok(logText.includes('registered'), 'registered transition logged');
    assert.ok(logText.includes('running'), 'running transition logged');
    assert.ok(logText.includes('completed'), 'completed transition logged');
  });

  await check('streaming partials reach the task log via logEvent', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'slow work', title: 'T-stream' });
    const st = bg._internals.readState(id);
    client._setPartial(st.childSessionID, 'STREAM-PARTIAL-XYZ');
    // Same wiring the plugin's bg_read stream:true uses: each poll partial is
    // appended via logEvent; the read still resolves normally (timeout here).
    const outcome = await bg.readDelegation(id, 150, (partial) => bg.logEvent(id, partial));
    assert.strictEqual(outcome, 'timeout: still running', 'read still returns normally: ' + outcome);
    const logText = fs.readFileSync(bg.logPath(id), 'utf-8');
    assert.ok(logText.includes('STREAM-PARTIAL-XYZ'), 'partial reached the log: ' + logText);
  });

  await check('log lines never contain secrets (type + redacted summary only)', async () => {
    const client = makeFakeClient();
    const store = tmpDir();
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    const id = await bg.createDelegation({ prompt: 'do work', title: 'plain title' });
    const st = bg._internals.readState(id);
    client._markComplete(st.childSessionID, 'finished api_key=LEAKME123 all good');
    await bg.readDelegation(id, 2000);
    const logText = fs.readFileSync(bg.logPath(id), 'utf-8');
    assert.ok(!logText.includes('LEAKME123'), 'raw secret must not reach the log: ' + logText);
    assert.ok(logText.includes('completed'), 'completed transition still logged: ' + logText);
  });

  await check('logEvent never throws (missing store, odd input)', async () => {
    const client = makeFakeClient();
    const store = path.join(tmpDir(), 'no-such-dir');
    const bg = createBackgroundDelegate({ client, storeDir: store, directory: '/tmp' });
    bg.logEvent('bg_x', 'hello');
    bg.logEvent(null, 'hello');
    bg.logEvent('bg_x', null);
    bg.logEvent('bg_x', { nested: 'api_key=zzz' });
    assert.ok(fs.existsSync(path.join(store, 'bg_x.log')), 'store dir created on demand, logging survived');
    assert.ok(!fs.readFileSync(path.join(store, 'bg_x.log'), 'utf-8').includes('zzz'), 'object payload redacted');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
