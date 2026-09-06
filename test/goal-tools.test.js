#!/usr/bin/env node

/**
 * goal-tools.test.js — drives the seven goal tools on plugins/swe-pro-agents.js
 * (get_goal, set_goal, list_all_goals, get_goal_history, update_goal_objective,
 * update_goal_status, clear_goal) with a fake client. Verifies the full
 * programmatic lifecycle plus input validation. Ephemeral by design: no disk
 * state is asserted, only the in-memory records.
 *
 * Zero dependencies: node:assert + node:fs + node:os + node:path.
 * Run with: node test/goal-tools.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Isolate the delegation store and disable the supervisor timer: these tests
// never touch delegations, but plugin.server() wires the engine eagerly.
process.env.SWE_PRO_DELEGATIONS_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-tools-store-'));
process.env.SWE_PRO_BG_SUPERVISOR = '0';
// Isolate HOME too (review m2): goal-flag reads fall back to a global file
// under ~/.config, so a real-HOME opt-out must not leak into these tests.
const ISOLATED_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'goal-tools-home-'));
process.env.HOME = ISOLATED_HOME;
process.env.USERPROFILE = ISOLATED_HOME;
process.env.HOMEDRIVE = path.parse(ISOLATED_HOME).root;
process.env.HOMEPATH = ISOLATED_HOME.replace(path.parse(ISOLATED_HOME).root, '');

const plugin = require('../plugins/swe-pro-agents.js');

let passed = 0;
let failed = 0;

/** Run one test; prints the outcome and records pass/fail totals. */
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`ok - ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`FAIL - ${name}\n  ${err && err.message ? err.message : err}`);
    });
}

function fakeClient() {
  return { session: {} };
}

async function tools() {
  const server = await plugin.server({
    client: fakeClient(),
    directory: fs.mkdtempSync(path.join(os.tmpdir(), 'goal-tools-dir-')),
  });
  return server.tool;
}

async function main() {
  await test('set_goal creates and get_goal reads back', async () => {
    const t = await tools();
    const created = JSON.parse(await t.set_goal.execute({ sessionID: 's-set', objective: 'ship it' }));
    assert.strictEqual(created.armed, true);
    assert.strictEqual(created.objective, 'ship it');
    const read = JSON.parse(await t.get_goal.execute({ sessionID: 's-set' }));
    assert.deepStrictEqual(read, created);
  });

  await test('set_goal defaults sessionID from the tool context', async () => {
    const t = await tools();
    const created = JSON.parse(await t.set_goal.execute({ objective: 'ctx goal' }, { sessionID: 's-ctx' }));
    assert.strictEqual(created.sessionID, 's-ctx');
    assert.strictEqual(created.objective, 'ctx goal');
  });

  await test('set_goal rejects empty objectives and missing sessions', async () => {
    const t = await tools();
    await assert.rejects(t.set_goal.execute({ sessionID: 's-bad', objective: '   ' }), /non-empty objective/);
    await assert.rejects(t.set_goal.execute({ objective: 'no session' }, {}), /requires a sessionID/);
  });

  await test('get_goal returns null for unknown sessions', async () => {
    const t = await tools();
    assert.strictEqual(await t.get_goal.execute({ sessionID: 's-ghost-1' }), 'null');
  });

  await test('list_all_goals lists every known session', async () => {
    plugin.reset(); // gate state is process-global; isolate from earlier tests
    const t = await tools();
    await t.set_goal.execute({ sessionID: 's-l1', objective: 'first' });
    await t.set_goal.execute({ sessionID: 's-l2', objective: 'second' });
    const list = JSON.parse(await t.list_all_goals.execute({}));
    const ids = list.map((g) => g.sessionID).sort();
    assert.deepStrictEqual(ids, ['s-l1', 's-l2']);
  });

  await test('history records set, pause, and resume transitions', async () => {
    const t = await tools();
    await t.set_goal.execute({ sessionID: 's-h', objective: 'track me' });
    await t.update_goal_status.execute({ sessionID: 's-h', status: 'paused' });
    await t.update_goal_status.execute({ sessionID: 's-h', status: 'active' });
    const history = JSON.parse(await t.get_goal_history.execute({ sessionID: 's-h' }));
    assert.deepStrictEqual(
      history.map((e) => e.action),
      ['set', 'paused', 'resumed']
    );
    const read = JSON.parse(await t.get_goal.execute({ sessionID: 's-h' }));
    assert.strictEqual(read.armed, true);
    assert.strictEqual(read.status, 'active');
  });

  await test('update_goal_objective replaces, unknown throws', async () => {
    const t = await tools();
    await t.set_goal.execute({ sessionID: 's-o', objective: 'v1' });
    const updated = JSON.parse(await t.update_goal_objective.execute({ sessionID: 's-o', objective: 'v2' }));
    assert.strictEqual(updated.objective, 'v2');
    assert.strictEqual(updated.armed, true, 'objective update must not disarm');
    await assert.rejects(
      t.update_goal_objective.execute({ sessionID: 's-ghost-2', objective: 'x' }),
      /no goal for session/
    );
  });

  await test('update_goal_status validates values, pausing unknown returns null', async () => {
    const t = await tools();
    await assert.rejects(
      t.update_goal_status.execute({ sessionID: 's-v', status: 'done' }),
      /active.*paused/
    );
    assert.strictEqual(await t.update_goal_status.execute({ sessionID: 's-ghost-3', status: 'paused' }), 'null');
    const created = JSON.parse(await t.update_goal_status.execute({ sessionID: 's-fresh', status: 'active' }));
    assert.strictEqual(created.armed, true, 'activating unknown mirrors /resume_goal');
  });

  await test('clear_goal forgets, then reports absence', async () => {
    const t = await tools();
    await t.set_goal.execute({ sessionID: 's-c', objective: 'bye' });
    assert.strictEqual(await t.clear_goal.execute({ sessionID: 's-c' }), '{"cleared":true}');
    assert.strictEqual(await t.clear_goal.execute({ sessionID: 's-c' }), '{"cleared":false}');
    assert.strictEqual(await t.get_goal.execute({ sessionID: 's-c' }), 'null');
    assert.deepStrictEqual(JSON.parse(await t.get_goal_history.execute({ sessionID: 's-c' })), []);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();
