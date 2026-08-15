#!/usr/bin/env node

/**
 * Self-tests for scripts/run-loop.js.
 *
 * Drives the runner as a CLI (spawnSync) against throwaway plan dirs: dry-run
 * ledger init, dispatch of the first task with the cliMode continuation
 * message, stdin-driven result recording (done advances, fail twice blocks and
 * stops), the --max-iterations budget, resume of an interrupted run, the
 * --json output shape, and the 0/1/2 exit-code contract.
 *
 * Zero dependencies: node:assert + node:child_process + node:fs + node:os + node:path.
 * Run with: node test/run-loop.test.js
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUN_LOOP = path.join(__dirname, '..', 'scripts', 'run-loop.js');

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

/** Build a plan dir from a { relPath: content } map and return its path. */
function planDir(files) {
  const dir = tempDir('run-loop-');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

/** Run the loop runner as a CLI; empty stdin by default (immediate EOF). */
function runLoop(args, input) {
  return spawnSync(process.execPath, [RUN_LOOP, ...args], {
    encoding: 'utf8',
    input: input === undefined ? '' : input,
  });
}

/** Read the ledger written by the runner. */
function readLedger(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
}

/** A valid schema-v1 ledger state with two pending tasks. */
function ledgerState() {
  return {
    version: 1,
    status: 'running',
    plan: 'plans/tasks.md',
    iterations: 0,
    tasks: [
      { id: 'T-001', phase: '1', title: 'First task', status: 'pending', attempts: 0, last_verify: null },
      { id: 'T-002', phase: '2', title: 'Second task', status: 'pending', attempts: 0, last_verify: null },
    ],
    budget: {
      max_attempts_per_task: 2,
      max_iterations_per_run: 40,
      started_at: '2026-01-01T00:00:00.000Z',
    },
  };
}

const TASKS_MD = `# Tasks

### T-001 — First task

**Phase.** 1

**Build.** Build the thing.

### T-002 — Second task

**Phase.** 2

**Build.** Build the other thing.
`;

// ---------------------------------------------------------------------------
// Dry run
// ---------------------------------------------------------------------------
test('dry-run inits the ledger, prints the summary, and exits 0', () => {
  const dir = planDir({ 'tasks.md': TASKS_MD });
  const r = runLoop(['--plan', dir, '--dry-run']);
  assert.strictEqual(r.status, 0, `dry-run should exit 0:\n${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes('Dry run'), 'expected the dry-run header');
  assert.ok(r.stdout.includes('running | done 0/2'), 'expected the summary');
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.status, 'running');
  assert.strictEqual(ledger.tasks.length, 2);
  assert.ok(ledger.tasks.every((t) => t.status === 'pending'), 'all tasks should start pending');
});

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------
test('dispatch prints the first task id and the cliMode continuation message, exits 0', () => {
  const dir = planDir({ 'tasks.md': TASKS_MD });
  const r = runLoop(['--plan', dir]);
  assert.strictEqual(r.status, 0, `dispatch should exit 0:\n${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes('Next task: T-001'), 'expected the first task id');
  assert.ok(r.stdout.includes('CLI-driven run'), 'expected the cliMode continuation message');
  assert.ok(r.stdout.includes('<promise>DONE</promise>'), 'expected the completion promise');
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.tasks[0].status, 'in_progress', 'dispatched task should be in_progress');
});

// ---------------------------------------------------------------------------
// stdin-driven result recording
// ---------------------------------------------------------------------------
test('done on stdin records the result and advances to the next task', () => {
  const dir = planDir({ 'tasks.md': TASKS_MD });
  const r = runLoop(['--plan', dir], 'done\n');
  assert.strictEqual(r.status, 0, `should exit 0:\n${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes('Next task: T-001'), 'expected the first dispatch');
  assert.ok(r.stdout.includes('Next task: T-002'), 'expected the second dispatch');
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.tasks[0].status, 'done');
  assert.strictEqual(ledger.tasks[1].status, 'in_progress');
  assert.strictEqual(ledger.iterations, 1);
});

test('fail twice blocks the task and stops the loop', () => {
  const dir = planDir({ 'tasks.md': TASKS_MD });
  const r = runLoop(['--plan', dir], 'fail\nfail\n');
  assert.strictEqual(r.status, 0, `should exit 0:\n${r.stdout}${r.stderr}`);
  assert.ok(
    r.stdout.includes('blocked | done 0/2 | next T-002 | blocked T-001 | attempts 2'),
    'expected the blocked summary'
  );
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.status, 'blocked');
  assert.strictEqual(ledger.tasks[0].status, 'blocked');
  assert.strictEqual(ledger.tasks[0].attempts, 2);
});

// ---------------------------------------------------------------------------
// Iteration budget
// ---------------------------------------------------------------------------
test('--max-iterations stops the loop at the budget', () => {
  const dir = planDir({ 'tasks.md': TASKS_MD });
  const r = runLoop(['--plan', dir, '--max-iterations', '1', '--json'], 'done\n');
  assert.strictEqual(r.status, 0, `should exit 0:\n${r.stdout}${r.stderr}`);
  const objects = r.stdout.trim().split(/\n(?=\{)/).map((s) => JSON.parse(s));
  const last = objects[objects.length - 1];
  assert.strictEqual(last.command, 'run');
  assert.strictEqual(last.status, 'stopped');
  assert.strictEqual(last.reason, 'iteration budget exhausted');
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.iterations, 1);
});

// ---------------------------------------------------------------------------
// Resume
// ---------------------------------------------------------------------------
test('resume records the in_progress task result before dispatching', () => {
  const state = ledgerState();
  state.tasks[0].status = 'in_progress';
  const dir = planDir({ 'tasks.md': TASKS_MD, 'state.json': JSON.stringify(state) });
  const r = runLoop(['--plan', dir], 'done\n');
  assert.strictEqual(r.status, 0, `should exit 0:\n${r.stdout}${r.stderr}`);
  assert.ok(r.stdout.includes('Next task: T-002'), 'expected the next task, not the resumed one');
  assert.ok(!r.stdout.includes('Next task: T-001'), 'the resumed task must not be re-dispatched');
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.tasks[0].status, 'done');
  assert.strictEqual(ledger.tasks[1].status, 'in_progress');
});

// ---------------------------------------------------------------------------
// --json output shape
// ---------------------------------------------------------------------------
test('--json emits machine-readable output on stdout and human lines on stderr', () => {
  const dir = planDir({ 'tasks.md': TASKS_MD });
  const r = runLoop(['--plan', dir, '--json']);
  assert.strictEqual(r.status, 0, `should exit 0:\n${r.stdout}${r.stderr}`);
  const obj = JSON.parse(r.stdout);
  assert.strictEqual(obj.command, 'run');
  assert.strictEqual(obj.status, 'dispatched');
  assert.deepStrictEqual(obj.task, { id: 'T-001', phase: '1', title: 'First task' });
  assert.ok(obj.message.includes('CLI-driven run'), 'expected the cliMode message');
  assert.ok(obj.summary.includes('running | done 0/2'), 'expected the summary');
  assert.ok(r.stderr.includes('CLI-driven run'), 'human lines should go to stderr in json mode');
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------
test('a missing plan file exits 1', () => {
  const dir = planDir({});
  const r = runLoop(['--plan', dir]);
  assert.strictEqual(r.status, 1, 'missing plan should exit 1');
  assert.ok(r.stderr.includes('[run-loop] Error: plan file not found'), 'expected the error message');
});

test('an unknown flag exits 2', () => {
  const r = runLoop(['--bogus']);
  assert.strictEqual(r.status, 2, 'unknown flag should exit 2');
  assert.ok(r.stderr.includes("unknown flag '--bogus'"), 'expected the usage error');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);