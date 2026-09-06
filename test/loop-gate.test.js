#!/usr/bin/env node

/**
 * Tests for scripts/loop-gate.js — deep LoopGate module.
 *
 * Interface is test surface: handleGoalEvent, isArmed, shouldNudge, explain.
 * No need to drive fake OpenCode events past the plugin adapter.
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const gate = require('../scripts/loop-gate.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}\n  ${err.message}`);
  }
}

function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  return dir;
}

function resumableLedger() {
  return JSON.stringify({ status: 'running', tasks: [{ id: 'T-001', status: 'pending' }] });
}

function blockedLedger() {
  return JSON.stringify({ status: 'running', tasks: [{ id: 'T-001', status: 'in_progress' }] });
}

// Ensure isolation — gate's Map is module singleton
function reset() {
  gate.reset();
}

// ---------------------------------------------------------------------------
// handleGoalEvent — arm
// ---------------------------------------------------------------------------
test('handleGoalEvent arms on bare /goal', () => {
  reset();
  const r = gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: '' } });
  assert.strictEqual(r.handled, true);
  assert.strictEqual(r.armed, true);
  assert.strictEqual(gate.isArmed('s1'), true);
});

test('handleGoalEvent arms on objective', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'implement T-001' } });
  assert.strictEqual(gate.isArmed('s1'), true);
});

test('handleGoalEvent arms on resume', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'resume' } });
  assert.strictEqual(gate.isArmed('s1'), true);
  // resume with objective also arms
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'Resume with new objective' } });
  // lowercased, not exact 'resume' but still arms (resume is substring of string? No — only exact 'resume' is resume action, but any non-DISARM arms)
  assert.strictEqual(gate.isArmed('s1'), true);
});

// ---------------------------------------------------------------------------
// handleGoalEvent — disarm
// ---------------------------------------------------------------------------
test('handleGoalEvent disarms on clear and aliases', () => {
  for (const alias of ['clear', 'stop', 'off', 'reset', 'none', 'cancel']) {
    reset();
    gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: alias } });
    assert.strictEqual(gate.isArmed('s1'), false, `alias ${alias} should disarm`);
    // also upper-case
    reset();
    gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: alias.toUpperCase() } });
    assert.strictEqual(gate.isArmed('s1'), false, `alias ${alias.toUpperCase()} should disarm`);
  }
});

test('handleGoalEvent disarms on pause', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'pause' } });
  assert.strictEqual(gate.isArmed('s1'), false);
});

test('pause_goal pauses regardless of arguments', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'objective' } });
  assert.strictEqual(gate.isArmed('s1'), true);
  const r = gate.handleGoalEvent({ properties: { name: 'pause_goal', sessionID: 's1', arguments: 'whatever' } });
  assert.strictEqual(r.handled, true);
  assert.strictEqual(r.action, 'paused');
  assert.strictEqual(gate.isArmed('s1'), false);
});

test('resume_goal re-arms regardless of arguments', () => {
  reset();
  const r = gate.handleGoalEvent({ properties: { name: 'resume_goal', sessionID: 's1', arguments: '' } });
  assert.strictEqual(r.handled, true);
  assert.strictEqual(r.action, 'resumed');
  assert.strictEqual(gate.isArmed('s1'), true);
});

test('pause_goal/resume_goal ignore missing sessionID', () => {
  reset();
  assert.strictEqual(gate.handleGoalEvent({ properties: { name: 'pause_goal' } }).handled, false);
  assert.strictEqual(gate.handleGoalEvent({ properties: { name: 'resume_goal', sessionID: 's1', arguments: 42 } }).handled, false);
});

test('handleGoalEvent trims and lowercases', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: '  Pause  ' } });
  assert.strictEqual(gate.isArmed('s1'), false);
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: '  Clear  ' } });
  assert.strictEqual(gate.isArmed('s1'), false);
});

// ---------------------------------------------------------------------------
// handleGoalEvent — ignore
// ---------------------------------------------------------------------------
test('handleGoalEvent ignores non-goal command', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'objective' } });
  assert.strictEqual(gate.isArmed('s1'), true);
  gate.handleGoalEvent({ properties: { name: 'other', sessionID: 's1', arguments: 'clear' } });
  assert.strictEqual(gate.isArmed('s1'), true, 'non-goal should not disarm');
});

test('handleGoalEvent ignores missing sessionID and non-string args', () => {
  reset();
  let r = gate.handleGoalEvent({ properties: { name: 'goal', arguments: '' } });
  assert.strictEqual(r.handled, false);
  r = gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 42 } });
  assert.strictEqual(r.handled, false);
  r = gate.handleGoalEvent({ properties: { name: 'goal' } });
  assert.strictEqual(r.handled, false);
  r = gate.handleGoalEvent(null);
  assert.strictEqual(r.handled, false);
});

test('handleGoalEvent show/status/help are neutral (no arm/disarm)', () => {
  // armed first
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'obj' } });
  assert.strictEqual(gate.isArmed('s1'), true);
  // neutral subcommands must not change arm state
  for (const sub of ['show', 'status', 'help']) {
    gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: sub } });
    assert.strictEqual(gate.isArmed('s1'), true, `${sub} must not disarm`);
  }
  // disarmed, then neutral must not re-arm
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'clear' } });
  assert.strictEqual(gate.isArmed('s1'), false);
  for (const sub of ['show', 'status', 'help']) {
    gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: sub } });
    assert.strictEqual(gate.isArmed('s1'), false, `${sub} must not arm`);
  }
});

// ---------------------------------------------------------------------------
// isArmed / explain
// ---------------------------------------------------------------------------
test('isArmed and explain reflect gate state', () => {
  reset();
  assert.strictEqual(gate.isArmed('s1'), false);
  assert.deepStrictEqual(gate.explain('s1'), { armed: false, reason: 'not-armed' });
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'obj' } });
  assert.strictEqual(gate.isArmed('s1'), true);
  assert.deepStrictEqual(gate.explain('s1'), { armed: true, reason: 'goal-active' });
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'clear' } });
  assert.strictEqual(gate.isArmed('s1'), false);
});

test('explain handles no-session', () => {
  assert.deepStrictEqual(gate.explain(null), { armed: false, reason: 'no-session' });
  assert.deepStrictEqual(gate.explain(''), { armed: false, reason: 'no-session' });
});

test('explain reports paused distinctly from never-armed', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'obj' } });
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'pause' } });
  assert.strictEqual(gate.isArmed('s1'), false);
  assert.deepStrictEqual(gate.explain('s1'), { armed: false, reason: 'paused' });
});

test('paused sessions never nudge', () => {
  reset();
  const ledgerDir = tempDir('gate-paused-');
  fs.mkdirSync(path.join(ledgerDir, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, 'plans', 'state.json'), resumableLedger());
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'obj' } });
  assert.strictEqual(gate.shouldNudge({ directory: ledgerDir, sessionID: 's1', sessionAgent: 'swe-pro' }), true);
  gate.handleGoalEvent({ properties: { name: 'pause_goal', sessionID: 's1', arguments: '' } });
  assert.strictEqual(gate.shouldNudge({ directory: ledgerDir, sessionID: 's1', sessionAgent: 'swe-pro' }), false);
  fs.rmSync(ledgerDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Programmatic goal record API (backs the get/set/list/history tools)
// ---------------------------------------------------------------------------
test('setGoal/getGoal round-trip with explicit objective', () => {
  reset();
  const created = gate.setGoal('s1', 'ship it');
  assert.strictEqual(created.armed, true);
  assert.strictEqual(created.status, 'active');
  assert.strictEqual(created.objective, 'ship it');
  assert.deepStrictEqual(gate.getGoal('s1'), created);
  assert.strictEqual(gate.isArmed('s1'), true);
});

test('setGoal validates input', () => {
  reset();
  assert.throws(() => gate.setGoal('', 'x'), /sessionID/);
  assert.throws(() => gate.setGoal('s1', '   '), /non-empty objective/);
  assert.throws(() => gate.setGoal('s1', 42), /non-empty objective/);
});

test('getGoal/history tolerate unknown sessions', () => {
  reset();
  assert.strictEqual(gate.getGoal('ghost'), null);
  assert.deepStrictEqual(gate.getGoalHistory('ghost'), []);
  assert.strictEqual(gate.getGoal(null), null);
});

test('listGoals returns every known session oldest-touched first', () => {
  reset();
  gate.setGoal('s-a', 'first');
  gate.setGoal('s-b', 'second');
  const ids = gate.listGoals().map((g) => g.sessionID);
  assert.deepStrictEqual(ids, ['s-a', 's-b']);
  gate.clearGoal('s-a');
  assert.deepStrictEqual(gate.listGoals().map((g) => g.sessionID), ['s-b']);
});

test('history records transitions in order', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'obj' } });
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'pause' } });
  gate.handleGoalEvent({ properties: { name: 'resume_goal', sessionID: 's1', arguments: '' } });
  assert.deepStrictEqual(
    gate.getGoalHistory('s1').map((e) => e.action),
    ['set', 'paused', 'resumed']
  );
});

test('updateGoalObjective replaces, unknown throws', () => {
  reset();
  gate.setGoal('s1', 'v1');
  assert.strictEqual(gate.updateGoalObjective('s1', 'v2').objective, 'v2');
  assert.strictEqual(gate.isArmed('s1'), true, 'objective update must not disarm');
  assert.throws(() => gate.updateGoalObjective('ghost', 'x'), /no goal for session/);
  assert.throws(() => gate.updateGoalObjective('s1', ''), /non-empty objective/);
});

test('updateGoalStatus flips, validates, and mirrors resume semantics', () => {
  reset();
  assert.strictEqual(gate.updateGoalStatus('s1', 'paused'), null, 'pausing unknown is a no-op');
  const created = gate.updateGoalStatus('s1', 'active');
  assert.strictEqual(created.armed, true, 'activating unknown creates (mirrors /resume_goal)');
  assert.strictEqual(gate.updateGoalStatus('s1', 'paused').armed, false);
  assert.throws(() => gate.updateGoalStatus('s1', 'done'), /active.*paused/);
});

test('clearGoal forgets and reports', () => {
  reset();
  gate.setGoal('s1', 'bye');
  assert.strictEqual(gate.clearGoal('s1'), true);
  assert.strictEqual(gate.clearGoal('s1'), false);
  assert.strictEqual(gate.getGoal('s1'), null);
  assert.deepStrictEqual(gate.getGoalHistory('s1'), []);
});

test('/goal command path stores fresh objectives, keeps them on resume', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'ship the thing' } });
  assert.strictEqual(gate.getGoal('s1').objective, 'ship the thing');
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'resume' } });
  assert.strictEqual(gate.getGoal('s1').objective, 'ship the thing', 'resume must not clobber the objective');
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: '' } });
  assert.strictEqual(gate.getGoal('s1').objective, 'ship the thing', 'bare re-arm must not clobber either');
});

test('/goal command path preserves objective casing (review M1)', () => {
  reset();
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: '  Ship The Thing  ' } });
  assert.strictEqual(gate.getGoal('s1').objective, 'Ship The Thing', 'stored objective keeps original casing');
  gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'CLEAR' } });
  assert.strictEqual(gate.getGoal('s1'), null, 'matching stays case-insensitive');
});

// ---------------------------------------------------------------------------
// shouldNudge — uses directory + ledger
// ---------------------------------------------------------------------------
test('shouldNudge true only when agent, armed, and ledger resumable', () => {
  reset();
  const ledgerDir = tempDir('gate-ledger-');
  fs.mkdirSync(path.join(ledgerDir, 'plans'), { recursive: true });
  fs.writeFileSync(path.join(ledgerDir, 'plans', 'state.json'), resumableLedger());
  const emptyCwd = tempDir('gate-cwd-');
  const orig = process.cwd();
  process.chdir(emptyCwd);
  try {
    // not armed → false
    assert.strictEqual(gate.shouldNudge({ directory: ledgerDir, sessionID: 's1', sessionAgent: 'swe-pro' }), false);
    // arm → true
    gate.handleGoalEvent({ properties: { name: 'goal', sessionID: 's1', arguments: 'obj' } });
    assert.strictEqual(gate.shouldNudge({ directory: ledgerDir, sessionID: 's1', sessionAgent: 'swe-pro' }), true);
    // wrong agent → false
    assert.strictEqual(gate.shouldNudge({ directory: ledgerDir, sessionID: 's1', sessionAgent: 'architect' }), false);
    // in_progress ledger → false
    fs.writeFileSync(path.join(ledgerDir, 'plans', 'state.json'), blockedLedger());
    assert.strictEqual(gate.shouldNudge({ directory: ledgerDir, sessionID: 's1', sessionAgent: 'swe-pro' }), false);
    // missing ledger → false
    assert.strictEqual(gate.shouldNudge({ directory: emptyCwd, sessionID: 's1', sessionAgent: 'swe-pro' }), false);
  } finally {
    process.chdir(orig);
    fs.rmSync(ledgerDir, { recursive: true, force: true });
    fs.rmSync(emptyCwd, { recursive: true, force: true });
  }
});

test('shouldNudge never throws', () => {
  reset();
  assert.strictEqual(gate.shouldNudge({ directory: null, sessionID: null, sessionAgent: null }), false);
  assert.strictEqual(gate.shouldNudge({}), false);
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
test('DISARM set and NUDGE_MESSAGE are exported', () => {
  assert.ok(gate.DISARM_SUBCOMMANDS instanceof Set);
  assert.ok(gate.DISARM_SUBCOMMANDS.has('clear'));
  assert.ok(gate.DISARM_SUBCOMMANDS.has('pause'));
  assert.ok(!gate.DISARM_SUBCOMMANDS.has('show'));
  assert.ok(typeof gate.NUDGE_MESSAGE === 'string');
  assert.ok(gate.NUDGE_MESSAGE.includes('Autonomous loop'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
