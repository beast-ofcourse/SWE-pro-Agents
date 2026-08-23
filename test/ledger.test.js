#!/usr/bin/env node

/**
 * Tests for scripts/ledger.js — deep Ledger module.
 *
 * Verifies atomic save, load validation, init/open, isResumable, and that
 * the module correctly delegates to loop-logic's pure core while hiding fs details.
 * Uses temp dirs (future: inject fs adapter).
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ledger = require('../scripts/ledger.js');
const logic = require('../scripts/loop-logic.js');

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
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sampleTasks() {
  return logic.tasksFromMarkdown('### T-001 — a\n**Phase.** 1\n### T-002 — b\n**Phase.** 1\n');
}

// ---------------------------------------------------------------------------
// load / save / init
// ---------------------------------------------------------------------------
test('init creates a valid ledger and load round-trips', () => {
  const dir = tempDir('ledger-init-');
  fs.mkdirSync(dir, { recursive: true });
  const tasks = sampleTasks();
  const state = ledger.init(dir, tasks);
  assert.strictEqual(state.status, 'running');
  assert.strictEqual(state.tasks.length, 2);
  const loaded = ledger.load(dir);
  assert.deepStrictEqual(loaded.tasks.map((t) => t.id), ['T-001', 'T-002']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('save is atomic — no .tmp left, validates before write', () => {
  const dir = tempDir('ledger-atomic-');
  fs.mkdirSync(dir, { recursive: true });
  const tasks = sampleTasks();
  const state = logic.initState(tasks);
  ledger.save(dir, state);
  assert.ok(!fs.existsSync(path.join(dir, 'state.json.tmp')), 'no .tmp leak');
  assert.ok(fs.existsSync(path.join(dir, 'state.json')));
  // invalid state throws and does not write
  const bad = { ...state, status: 'bogus' };
  assert.throws(() => ledger.save(dir, bad), /refusing to save invalid state/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('load returns null on missing and corrupt', () => {
  const dir = tempDir('ledger-load-');
  fs.mkdirSync(dir, { recursive: true });
  assert.strictEqual(ledger.load(dir), null);
  fs.writeFileSync(path.join(dir, 'state.json'), 'not json');
  assert.strictEqual(ledger.load(dir), null);
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ version: 1, status: 'bogus', tasks: [] }));
  assert.strictEqual(ledger.load(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// open
// ---------------------------------------------------------------------------
test('open inits when no file, throws on corrupt, syncs with spec', () => {
  const dir = tempDir('ledger-open-');
  fs.mkdirSync(dir, { recursive: true });
  const tasks = sampleTasks();
  // no file → init
  const s1 = ledger.open(dir, tasks);
  assert.strictEqual(s1.tasks.length, 2);
  // existing valid → load
  const s2 = ledger.open(dir, tasks);
  assert.strictEqual(s2.tasks.length, 2);
  // corrupt file → throw (never silently replace)
  fs.writeFileSync(path.join(dir, 'state.json'), 'corrupt');
  assert.throws(() => ledger.open(dir, tasks), /could not be loaded/);
  // fix, then add a new task → sync
  ledger.init(dir, tasks);
  const tasksPlus = [...tasks, { id: 'T-003', phase: '1', title: 'c' }];
  const s3 = ledger.open(dir, tasksPlus);
  assert.strictEqual(s3.tasks.length, 3);
  assert.strictEqual(s3.tasks[2].id, 'T-003');
  // remove a task → drop
  const tasksMinus = [tasks[0]];
  const s4 = ledger.open(dir, tasksMinus);
  assert.strictEqual(s4.tasks.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('open without tasks returns null when no file', () => {
  const dir = tempDir('ledger-open-null-');
  fs.mkdirSync(dir, { recursive: true });
  assert.strictEqual(ledger.open(dir, null), null);
  assert.strictEqual(ledger.open(dir), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// isResumable
// ---------------------------------------------------------------------------
test('isResumable true only when running, !in_progress, pending', () => {
  const dir = tempDir('ledger-resumable-');
  fs.mkdirSync(dir, { recursive: true });
  const tasks = sampleTasks();
  ledger.init(dir, tasks);
  assert.strictEqual(ledger.isResumable(dir), true);
  // mark in_progress → not resumable
  let state = ledger.load(dir);
  state = logic.markInProgress(state, 'T-001');
  ledger.save(dir, state);
  assert.strictEqual(ledger.isResumable(dir), false);
  // done → not resumable
  state = ledger.load(dir);
  state = logic.applyAttemptResult(state, 'T-001', 'done');
  state = logic.applyAttemptResult(state, 'T-002', 'done');
  ledger.save(dir, state);
  assert.strictEqual(ledger.isResumable(dir), false);
  // blocked status → not resumable
  fs.rmSync(dir, { recursive: true, force: true });
  const dir2 = tempDir('ledger-resumable2-');
  fs.mkdirSync(dir2, { recursive: true });
  const s = logic.initState(tasks);
  s.status = 'paused';
  ledger.save(dir2, s);
  assert.strictEqual(ledger.isResumable(dir2), false);
  // missing file → false, never throws
  assert.strictEqual(ledger.isResumable(path.join(os.tmpdir(), 'no-such-dir-xyz')), false);
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('isResumable never throws', () => {
  assert.strictEqual(ledger.isResumable(null), false);
  assert.strictEqual(ledger.isResumable(''), false);
});

// ---------------------------------------------------------------------------
// re-exports
// ---------------------------------------------------------------------------
test('re-exports pure helpers', () => {
  assert.strictEqual(typeof ledger.shouldContinue, 'function');
  assert.strictEqual(typeof ledger.nextTask, 'function');
  assert.strictEqual(typeof ledger.summary, 'function');
  const dir = tempDir('ledger-summary-');
  fs.mkdirSync(dir, { recursive: true });
  ledger.init(dir, sampleTasks());
  assert.ok(ledger.summary(dir).includes('running'));
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
