'use strict';

/**
 * background-plugin.test.js — drives plugins/swe-pro-agents-background.js
 * end-to-end with a fake in-process client. Verifies tool shapes, delegation
 * flow, and that a parent notification fires on terminal.
 */

const assert = require('assert');
const { createBackgroundDelegate } = require('../scripts/background-delegate.js');

// Disable the supervisor timer so the test controls reconciliation.
process.env.SWE_PRO_BG_SUPERVISOR = '0';

const plugin = require('../plugins/swe-pro-agents-background.js');

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
    client._markComplete('child_2', 'CHILD OUTPUT');
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
    const stopRet = await tools.bg_stop.execute({ id });
    assert.ok(stopRet.includes('stopped'), 'stop returns stopped status');
    assert.ok(stopRet.includes('cancelled'), 'state cancelled');
    assert.strictEqual(client._stats().createCount, 3, 'three children created total');
  });

  await check('bg_steer prompts the running child (best-effort)', async () => {
    const ret = await tools.bg_delegate.execute({ prompt: 'task' }, { sessionID: 'parent1' });
    const id = ret.match(/delegated (bg_\S+)/)[1];
    const steerRet = await tools.bg_steer.execute({ id, prompt: 'also check Y' });
    assert.ok(steerRet.includes('steered'), 'steer returns steered status');
    const promptCalls = client._stats().promptCalls;
    const steered = promptCalls.find((p) => p.id === 'child_4' && JSON.stringify(p.body).includes('also check Y'));
    assert.ok(steered, 'child_4 was prompted with the steer instruction');
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

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
