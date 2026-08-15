#!/usr/bin/env node

/**
 * Self-tests for scripts/loop-logic.js.
 *
 * Covers every export: tasksFromMarkdown, initState, validateState, nextTask,
 * shouldContinue, markInProgress, syncWithSpec, applyAttemptResult,
 * buildContinuationMessage, summary, and the loadState/saveState/initLedger
 * disk round-trip (atomic write, corrupt-file handling).
 *
 * Zero dependencies: node:assert + node:fs + node:os + node:path.
 * Run with: node test/loop-logic.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  LEDGER_SCHEMA_VERSION,
  CLI_DIRECTIVE,
  tasksFromMarkdown,
  initState,
  validateState,
  nextTask,
  shouldContinue,
  markInProgress,
  syncWithSpec,
  applyAttemptResult,
  buildContinuationMessage,
  summary,
  loadState,
  saveState,
  initLedger,
} = require('../scripts/loop-logic.js');

let passed = 0;
let failed = 0;

/** Temp dirs created during this run, removed at process exit. */
const tempDirs = [];

// Sync-only in the handler, so it also runs when tests fail (process.exit(1)).
process.on('exit', () => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Run one test; prints the outcome and records pass/fail totals. */
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

/** Create a tracked throwaway dir (removed at process exit). */
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** A valid schema-v1 ledger state with two pending tasks. */
function validState() {
  return {
    version: LEDGER_SCHEMA_VERSION,
    status: 'running',
    plan: 'plans/tasks.md',
    iterations: 0,
    tasks: [
      { id: 'T-001', phase: '1', title: 'First task', status: 'pending', attempts: 0, last_verify: null },
      { id: 'T-002', phase: '', title: 'Second task', status: 'pending', attempts: 0, last_verify: null },
    ],
    budget: {
      max_attempts_per_task: 2,
      max_iterations_per_run: 40,
      started_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

// ---------------------------------------------------------------------------
// tasksFromMarkdown
// ---------------------------------------------------------------------------
test('tasksFromMarkdown parses ids, titles, and phases', () => {
  const md = [
    '### T-001 — First task',
    '',
    '**Phase.** 1',
    '',
    '**Build.** Build the thing.',
    '',
    '### T-002: Second task',
    '',
    '**Phase.** 2',
    '',
  ].join('\n');
  const tasks = tasksFromMarkdown(md);
  assert.strictEqual(tasks.length, 2);
  assert.deepStrictEqual(tasks[0], { id: 'T-001', phase: '1', title: 'First task' });
  assert.deepStrictEqual(tasks[1], { id: 'T-002', phase: '2', title: 'Second task' });
});

test('tasksFromMarkdown falls back to an empty title when the heading has none', () => {
  const tasks = tasksFromMarkdown('### T-001\n\n**Phase.** 1\n');
  assert.strictEqual(tasks.length, 1);
  assert.deepStrictEqual(tasks[0], { id: 'T-001', phase: '1', title: '' });
});

test('tasksFromMarkdown returns [] for empty or heading-less markdown', () => {
  assert.deepStrictEqual(tasksFromMarkdown(''), []);
  assert.deepStrictEqual(tasksFromMarkdown('# Tasks\n\nNo tasks here.\n'), []);
});

test('tasksFromMarkdown ignores non-task headings', () => {
  const md = ['# Tasks', '## T-001 — Wrong level', '### T-002 — Real task', '', '**Phase.** 2'].join('\n');
  const tasks = tasksFromMarkdown(md);
  assert.deepStrictEqual(tasks, [{ id: 'T-002', phase: '2', title: 'Real task' }]);
});

// ---------------------------------------------------------------------------
// initState
// ---------------------------------------------------------------------------
test('initState builds a fresh schema-v1 ledger from task descriptors', () => {
  const state = initState([
    { id: 'T-001', phase: '1', title: 'First task' },
    { id: 'T-002', phase: '', title: '' },
  ]);
  assert.strictEqual(state.version, LEDGER_SCHEMA_VERSION);
  assert.strictEqual(state.status, 'running');
  assert.strictEqual(state.plan, 'plans/tasks.md');
  assert.strictEqual(state.iterations, 0);
  assert.strictEqual(state.tasks.length, 2);
  assert.deepStrictEqual(state.tasks[0], {
    id: 'T-001',
    phase: '1',
    title: 'First task',
    status: 'pending',
    attempts: 0,
    last_verify: null,
  });
  assert.deepStrictEqual(state.tasks[1], {
    id: 'T-002',
    phase: '',
    title: '',
    status: 'pending',
    attempts: 0,
    last_verify: null,
  });
  assert.strictEqual(state.budget.max_attempts_per_task, 2);
  assert.strictEqual(state.budget.max_iterations_per_run, 40);
  assert.strictEqual(typeof state.budget.started_at, 'string');
});

test('initState handles missing or empty task lists', () => {
  assert.deepStrictEqual(initState().tasks, []);
  assert.deepStrictEqual(initState(null).tasks, []);
  assert.deepStrictEqual(initState(undefined).tasks, []);
});

// ---------------------------------------------------------------------------
// validateState
// ---------------------------------------------------------------------------
test('validateState accepts a valid state', () => {
  assert.deepStrictEqual(validateState(validState()), { ok: true, errors: [] });
});

test('validateState rejects a non-object state', () => {
  assert.deepStrictEqual(validateState(null), { ok: false, errors: ['state is not an object'] });
  assert.deepStrictEqual(validateState('running'), { ok: false, errors: ['state is not an object'] });
});

test('validateState rejects a wrong schema version', () => {
  const s = validState();
  s.version = 2;
  const r = validateState(s);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e === 'version 2 !== 1'), 'expected a version error');
});

test('validateState rejects an unknown ledger status', () => {
  const s = validState();
  s.status = 'in-flight';
  const r = validateState(s);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e === "invalid status 'in-flight'"), 'expected a status error');
});

test('validateState rejects missing or empty tasks', () => {
  const s = validState();
  s.tasks = [];
  const r = validateState(s);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e === 'tasks must be a non-empty array'), 'expected a tasks error');
});

test('validateState rejects an unknown task status', () => {
  const s = validState();
  s.tasks[0].status = 'in-flight';
  const r = validateState(s);
  assert.strictEqual(r.ok, false);
  assert.ok(
    r.errors.some((e) => e === "task 'T-001' has invalid status 'in-flight'"),
    'expected a task-status error'
  );
});

test('validateState rejects duplicate task ids', () => {
  const s = validState();
  s.tasks.push({ ...s.tasks[0] });
  const r = validateState(s);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e === "duplicate task id 'T-001'"), 'expected a duplicate-id error');
});

test('validateState rejects over-budget attempts on non-blocked tasks', () => {
  const s = validState();
  s.tasks[0].attempts = 3; // max_attempts_per_task is 2
  const r = validateState(s);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e === "task 'T-001' has 3 attempts (> 2)"), 'expected an over-budget error');
});

test('validateState allows over-budget attempts on blocked tasks', () => {
  const s = validState();
  s.tasks[0].status = 'blocked';
  s.tasks[0].attempts = 3;
  assert.deepStrictEqual(validateState(s), { ok: true, errors: [] });
});

test('validateState rejects negative iterations', () => {
  const s = validState();
  s.iterations = -1;
  const r = validateState(s);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e === 'iterations -1 < 0'), 'expected an iterations error');
});

// ---------------------------------------------------------------------------
// nextTask
// ---------------------------------------------------------------------------
test('nextTask returns the first pending task before any in_progress task', () => {
  const s = validState();
  s.tasks[0].status = 'in_progress';
  assert.strictEqual(nextTask(s).id, 'T-002');
});

test('nextTask resumes the first in_progress task when none are pending', () => {
  const s = validState();
  s.tasks[0].status = 'in_progress';
  s.tasks[1].status = 'done';
  assert.strictEqual(nextTask(s).id, 'T-001');
});

test('nextTask returns null when nothing is runnable', () => {
  const s = validState();
  s.tasks[0].status = 'done';
  s.tasks[1].status = 'blocked';
  assert.strictEqual(nextTask(s), null);
});

// ---------------------------------------------------------------------------
// shouldContinue
// ---------------------------------------------------------------------------
test('shouldContinue is true while running, under budget, unblocked, with a next task', () => {
  const s = validState();
  s.iterations = 39; // just under the 40-iteration budget
  assert.strictEqual(shouldContinue(s), true);
});

test('shouldContinue is false when the ledger is not running', () => {
  const s = validState();
  s.status = 'paused';
  assert.strictEqual(shouldContinue(s), false);
});

test('shouldContinue is false when the iteration budget is exhausted', () => {
  const s = validState();
  s.iterations = 40;
  assert.strictEqual(shouldContinue(s), false);
});

test('shouldContinue is false when any task is blocked (stop-on-blocked)', () => {
  const s = validState();
  s.tasks[0].status = 'blocked';
  assert.strictEqual(shouldContinue(s), false);
});

test('shouldContinue is false when there is no next task', () => {
  const s = validState();
  s.tasks[0].status = 'done';
  s.tasks[1].status = 'done';
  assert.strictEqual(shouldContinue(s), false);
});

// ---------------------------------------------------------------------------
// markInProgress
// ---------------------------------------------------------------------------
test('markInProgress marks a pending task in_progress without mutating the input', () => {
  const s = validState();
  const next = markInProgress(s, 'T-001');
  assert.strictEqual(next.tasks[0].status, 'in_progress');
  assert.strictEqual(s.tasks[0].status, 'pending');
  assert.notStrictEqual(next, s);
});

test('markInProgress is idempotent on an already in_progress task', () => {
  const s = validState();
  s.tasks[0].status = 'in_progress';
  assert.deepStrictEqual(markInProgress(s, 'T-001'), s);
});

test('markInProgress throws on an unknown task id', () => {
  assert.throws(() => markInProgress(validState(), 'T-999'), /unknown task id 'T-999'/);
});

test('markInProgress throws on a done task', () => {
  const s = validState();
  s.tasks[0].status = 'done';
  assert.throws(() => markInProgress(s, 'T-001'), /cannot mark 'T-001' in_progress: status is 'done'/);
});

test('markInProgress throws on a blocked task', () => {
  const s = validState();
  s.tasks[0].status = 'blocked';
  assert.throws(() => markInProgress(s, 'T-001'), /cannot mark 'T-001' in_progress: status is 'blocked'/);
});

// ---------------------------------------------------------------------------
// syncWithSpec
// ---------------------------------------------------------------------------
test('syncWithSpec adds spec tasks missing from the ledger as pending', () => {
  const s = validState();
  const spec = [
    { id: 'T-001', phase: '1', title: 'First task' },
    { id: 'T-003', phase: '2', title: 'Third task' },
  ];
  const { state, added, removed } = syncWithSpec(s, spec);
  assert.deepStrictEqual(added, ['T-003']);
  assert.deepStrictEqual(removed, ['T-002']);
  assert.strictEqual(state.tasks.length, 2);
  const addedTask = state.tasks.find((t) => t.id === 'T-003');
  assert.deepStrictEqual(addedTask, {
    id: 'T-003',
    phase: '2',
    title: 'Third task',
    status: 'pending',
    attempts: 0,
    last_verify: null,
  });
});

test('syncWithSpec drops ledger tasks missing from the spec', () => {
  const s = validState();
  const spec = [{ id: 'T-001', phase: '1', title: 'First task' }];
  const { state, added, removed } = syncWithSpec(s, spec);
  assert.deepStrictEqual(added, []);
  assert.deepStrictEqual(removed, ['T-002']);
  assert.deepStrictEqual(state.tasks.map((t) => t.id), ['T-001']);
});

test('syncWithSpec preserves status, attempts, last_verify, and ledger fields for matching ids', () => {
  const s = validState();
  s.tasks[0].status = 'in_progress';
  s.tasks[0].attempts = 1;
  s.tasks[0].last_verify = '2026-01-01T00:00:00.000Z';
  s.iterations = 5;
  const spec = [
    { id: 'T-001', phase: '1', title: 'First task' },
    { id: 'T-003', phase: '2', title: 'Third task' },
  ];
  const { state } = syncWithSpec(s, spec);
  assert.strictEqual(state.tasks[0].status, 'in_progress');
  assert.strictEqual(state.tasks[0].attempts, 1);
  assert.strictEqual(state.tasks[0].last_verify, '2026-01-01T00:00:00.000Z');
  assert.strictEqual(state.status, s.status);
  assert.strictEqual(state.iterations, 5);
});

// ---------------------------------------------------------------------------
// applyAttemptResult
// ---------------------------------------------------------------------------
test('done marks the task done, sets last_verify, and increments iterations', () => {
  const s = validState();
  const next = applyAttemptResult(s, 'T-001', 'done');
  assert.strictEqual(next.tasks[0].status, 'done');
  assert.strictEqual(typeof next.tasks[0].last_verify, 'string');
  assert.strictEqual(next.iterations, 1);
  assert.strictEqual(next.status, 'running'); // T-002 still pending
});

test('fail increments attempts and blocks the task and ledger at max attempts', () => {
  const s = validState();
  let next = applyAttemptResult(s, 'T-001', 'fail');
  assert.strictEqual(next.tasks[0].attempts, 1);
  assert.strictEqual(next.tasks[0].status, 'pending'); // below max, stays runnable
  assert.strictEqual(next.status, 'running');
  assert.strictEqual(next.iterations, 1);

  next = applyAttemptResult(next, 'T-001', 'fail');
  assert.strictEqual(next.tasks[0].attempts, 2);
  assert.strictEqual(next.tasks[0].status, 'blocked');
  assert.strictEqual(next.status, 'blocked');
  assert.strictEqual(next.iterations, 2);
});

test('fail below max resets an in_progress task to pending (never stuck in_progress)', () => {
  const s = validState();
  s.tasks[0].status = 'in_progress';
  const next = applyAttemptResult(s, 'T-001', 'fail');
  assert.strictEqual(next.tasks[0].attempts, 1);
  assert.strictEqual(next.tasks[0].status, 'pending', 'a failed attempt must not leave the task in_progress');
  assert.strictEqual(next.status, 'running');
});

test('all tasks done flips the ledger status to done', () => {
  const s = validState();
  let next = applyAttemptResult(s, 'T-001', 'done');
  next = applyAttemptResult(next, 'T-002', 'done');
  assert.strictEqual(next.status, 'done');
  assert.strictEqual(next.iterations, 2);
});

test('applyAttemptResult throws on an unknown result', () => {
  assert.throws(() => applyAttemptResult(validState(), 'T-001', 'skip'), /unknown result 'skip'/);
});

test('applyAttemptResult throws on an unknown task id', () => {
  assert.throws(() => applyAttemptResult(validState(), 'T-999', 'done'), /unknown task id 'T-999'/);
});

// ---------------------------------------------------------------------------
// buildContinuationMessage
// ---------------------------------------------------------------------------
test('interactive form instructs the ledger update', () => {
  const msg = buildContinuationMessage(validState());
  assert.ok(msg.includes('Next task: T-001'), 'expected the next-task header');
  assert.ok(msg.includes('Load plans/state.json'), 'expected the load instruction');
  assert.ok(msg.includes('mark the task in_progress'), 'expected the in_progress instruction');
  assert.ok(msg.includes('record it'), 'expected the record instruction');
});

test('cliMode form omits ledger instructions and includes the CLI directive', () => {
  const msg = buildContinuationMessage(validState(), { cliMode: true });
  assert.ok(!msg.includes('mark the task in_progress'), 'must not instruct a ledger update');
  assert.ok(!msg.includes('record it'), 'must not instruct recording');
  assert.ok(!msg.includes('Load plans/state.json'), 'must not instruct loading the ledger');
  assert.ok(msg.includes('CLI-driven run'), 'expected the CLI directive');
  assert.ok(msg.includes('<promise>DONE</promise>'), 'expected the completion promise');
});

test('CLI_DIRECTIVE is the exact sentence composed into cliMode messages and strips cleanly', () => {
  const msg = buildContinuationMessage(validState(), { cliMode: true });
  assert.ok(msg.includes(CLI_DIRECTIVE), 'the exported directive must be the composed sentence');
  const stripped = msg.replace(CLI_DIRECTIVE, ' ');
  assert.ok(!stripped.includes('CLI-driven run'), 'stripping the exported directive removes the sentence');
  assert.ok(stripped.includes('Next task: T-001'), 'the rest of the message survives');
});

test('buildContinuationMessage throws when there is no next task', () => {
  const s = validState();
  s.tasks[0].status = 'done';
  s.tasks[1].status = 'done';
  assert.throws(() => buildContinuationMessage(s), /no next task/);
});

// ---------------------------------------------------------------------------
// summary
// ---------------------------------------------------------------------------
test('summary emits the pinned format with next and attempts', () => {
  const s = validState();
  s.tasks[0].status = 'done';
  s.iterations = 3;
  assert.strictEqual(summary(s), 'running | done 1/2 | next T-002 | attempts 3');
});

test('summary includes the blocked segment and omits attempts at 0', () => {
  const s = validState();
  s.status = 'blocked';
  s.tasks[0].status = 'blocked';
  s.tasks[1].status = 'done';
  s.iterations = 0;
  assert.strictEqual(summary(s), 'blocked | done 1/2 | blocked T-001');
});

// ---------------------------------------------------------------------------
// loadState / saveState / initLedger
// ---------------------------------------------------------------------------
test('saveState writes atomically (no .tmp left behind) and loadState round-trips', () => {
  const dir = tempDir('loop-logic-');
  const ledgerPath = path.join(dir, 'state.json');
  const s = validState();
  saveState(ledgerPath, s);
  assert.ok(fs.existsSync(ledgerPath), 'ledger file should exist');
  assert.strictEqual(fs.existsSync(`${ledgerPath}.tmp`), false, 'no .tmp file should remain');
  assert.deepStrictEqual(loadState(ledgerPath), s);
});

test('loadState returns null for a missing file', () => {
  const dir = tempDir('loop-logic-');
  assert.strictEqual(loadState(path.join(dir, 'missing.json')), null);
});

test('loadState returns null for corrupt JSON', () => {
  const dir = tempDir('loop-logic-');
  const ledgerPath = path.join(dir, 'state.json');
  fs.writeFileSync(ledgerPath, '{ not json', 'utf8');
  assert.strictEqual(loadState(ledgerPath), null);
});

test('loadState returns null for a state that fails validation', () => {
  const dir = tempDir('loop-logic-');
  const ledgerPath = path.join(dir, 'state.json');
  const s = validState();
  s.version = 99;
  fs.writeFileSync(ledgerPath, JSON.stringify(s), 'utf8');
  assert.strictEqual(loadState(ledgerPath), null);
});

test('loadState returns null for a state without a budget', () => {
  const dir = tempDir('loop-logic-');
  const ledgerPath = path.join(dir, 'state.json');
  const s = validState();
  delete s.budget;
  fs.writeFileSync(ledgerPath, JSON.stringify(s), 'utf8');
  assert.strictEqual(loadState(ledgerPath), null);
});

test('saveState throws on an invalid state', () => {
  const dir = tempDir('loop-logic-');
  const s = validState();
  s.status = 'in-flight';
  assert.throws(() => saveState(path.join(dir, 'state.json'), s), /refusing to save invalid state/);
});

test('initLedger creates a fresh ledger on disk from markdown and returns it', () => {
  const dir = tempDir('loop-logic-');
  const ledgerPath = path.join(dir, 'state.json');
  const md = '### T-001 — First\n\n**Phase.** 1\n\n### T-002 — Second\n';
  const state = initLedger(ledgerPath, md);
  assert.strictEqual(state.version, LEDGER_SCHEMA_VERSION);
  assert.strictEqual(state.status, 'running');
  assert.strictEqual(state.tasks.length, 2);
  assert.strictEqual(state.tasks[0].id, 'T-001');
  assert.strictEqual(state.tasks[0].phase, '1');
  assert.strictEqual(state.tasks[0].status, 'pending');
  assert.ok(fs.existsSync(ledgerPath), 'ledger file should exist');
  assert.deepStrictEqual(loadState(ledgerPath), state);
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);