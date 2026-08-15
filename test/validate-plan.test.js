#!/usr/bin/env node

/**
 * Self-tests for scripts/validate-plan.js.
 *
 * Proves the plan validator works by running it against fixture plan dirs:
 * P1 (missing tasks.md, empty tasks.md), P2 (missing section, duplicate id),
 * P3 (orphan ledger task, invalid status), plus a clean-plan pass and the CLI
 * exit-code path.
 *
 * Zero dependencies: node:assert + node:child_process + node:fs + node:os + node:path.
 * Run with: node test/validate-plan.test.js
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { extractTasks, validatePlanDir } = require('../scripts/validate-plan.js');

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
  const dir = tempDir('validate-plan-');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const CLEAN_TASKS = `# Tasks

### T-001 — First task

**Build.** Build the thing.

**Acceptance criteria.**
- It works.

**Verify.** Run the tests.

### T-002 — Second task

**Phase.** 1

**Build.** Build the other thing.

**Acceptance criteria.**
- It also works.

**Verify.** Run the other tests.
`;

const CLEAN_STATE = JSON.stringify({
  status: 'running',
  tasks: [{ id: 'T-001' }, { id: 'T-002' }],
});

// ---------------------------------------------------------------------------
// Unit: extractTasks
// ---------------------------------------------------------------------------
test('extractTasks parses ids and falls back to the heading text for the title', () => {
  const tasks = extractTasks('### T-001 — First task\n\n**Build.** A.\n\n### T-002\n\n**Build.** B.\n');
  assert.strictEqual(tasks.length, 2);
  assert.strictEqual(tasks[0].id, 'T-001');
  assert.strictEqual(tasks[0].title, 'First task');
  assert.strictEqual(tasks[1].id, 'T-002');
  assert.strictEqual(tasks[1].title, '');
});

// ---------------------------------------------------------------------------
// P1 — plan presence
// ---------------------------------------------------------------------------
test('P1 flags a missing tasks.md', () => {
  const v = validatePlanDir(planDir({}));
  assert.ok(v.some((x) => x.rule === 'P1'), 'expected a P1 violation');
});

test('P1 flags an empty tasks.md (no task headings)', () => {
  const v = validatePlanDir(planDir({ 'tasks.md': '# Tasks\n\nNo tasks here.\n' }));
  assert.ok(v.some((x) => x.rule === 'P1'), 'expected a P1 violation');
});

// ---------------------------------------------------------------------------
// P2 — task shape
// ---------------------------------------------------------------------------
test('P2 flags a task missing a required section', () => {
  const tasks = '### T-001 — First task\n\n**Build.** Build the thing.\n\n**Verify.** Run the tests.\n';
  const v = validatePlanDir(planDir({ 'tasks.md': tasks }));
  assert.ok(
    v.some((x) => x.rule === 'P2' && /Acceptance criteria/.test(x.detail)),
    'expected a P2 violation for the missing section'
  );
});

test('P2 flags duplicate task ids', () => {
  const tasks = `### T-001 — First
**Build.** A.
**Acceptance criteria.**
- A.
**Verify.** A.

### T-001 — Duplicate
**Build.** B.
**Acceptance criteria.**
- B.
**Verify.** B.
`;
  const v = validatePlanDir(planDir({ 'tasks.md': tasks }));
  assert.ok(
    v.some((x) => x.rule === 'P2' && /duplicate task id/.test(x.detail)),
    'expected a P2 violation for the duplicate id'
  );
});

// ---------------------------------------------------------------------------
// P3 — ledger consistency
// ---------------------------------------------------------------------------
test('P3 flags an orphan task in the ledger', () => {
  const state = JSON.stringify({ status: 'running', tasks: [{ id: 'T-001' }, { id: 'T-999' }] });
  const v = validatePlanDir(planDir({ 'tasks.md': CLEAN_TASKS, 'state.json': state }));
  assert.ok(v.some((x) => x.rule === 'P3' && /orphan/.test(x.detail)), 'expected a P3 violation for the orphan');
});

test('P3 flags an invalid ledger status', () => {
  const state = JSON.stringify({ status: 'in-flight', tasks: [{ id: 'T-001' }, { id: 'T-002' }] });
  const v = validatePlanDir(planDir({ 'tasks.md': CLEAN_TASKS, 'state.json': state }));
  assert.ok(v.some((x) => x.rule === 'P3' && /invalid status/.test(x.detail)), 'expected a P3 violation for the status');
});

// ---------------------------------------------------------------------------
// Clean pass
// ---------------------------------------------------------------------------
test('a clean plan dir passes with zero violations', () => {
  const v = validatePlanDir(planDir({ 'tasks.md': CLEAN_TASKS, 'state.json': CLEAN_STATE }));
  assert.deepStrictEqual(v, []);
});

// ---------------------------------------------------------------------------
// CLI exit-code path
// ---------------------------------------------------------------------------
test('CLI exits 0 against a clean plan dir, 1 against a broken one', () => {
  const script = path.join(__dirname, '..', 'scripts', 'validate-plan.js');
  const clean = planDir({ 'tasks.md': CLEAN_TASKS, 'state.json': CLEAN_STATE });
  const broken = planDir({});

  const ok = spawnSync(process.execPath, [script, clean], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, `clean plan dir should exit 0:\n${ok.stdout}${ok.stderr}`);

  const bad = spawnSync(process.execPath, [script, broken], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1, 'broken plan dir should exit 1');
  assert.ok(/\[FAIL\]/.test(bad.stdout), 'broken plan dir output should contain [FAIL]');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);