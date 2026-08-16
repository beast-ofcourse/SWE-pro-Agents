#!/usr/bin/env node

/**
 * Self-tests for bin/swe-pro-agents.js (the `run` command).
 *
 * Drives the CLI as a subprocess (spawnSync) against throwaway plan dirs:
 * ledger init + dispatch, reconciliation of a resumed ledger against a
 * changed tasks.md (the CodeRabbit syncWithSpec regression), and the
 * error-path exit codes (missing plan file, empty plan, corrupt ledger —
 * which must never be silently replaced).
 *
 * Zero dependencies: node:assert + node:child_process + node:fs + node:os + node:path.
 * Run with: node test/bin.test.js
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = path.join(__dirname, '..', 'bin', 'swe-pro-agents.js');

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
  const dir = tempDir('bin-test-');
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

/** Run the CLI `run` command as a subprocess. */
function runBin(args) {
  return spawnSync(process.execPath, [BIN, 'run', ...args], { encoding: 'utf8' });
}

/** Read the ledger written by the CLI. */
function readLedger(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
}

/** A minimal tasks.md with the given task ids. */
function tasksMd(ids) {
  return ids.map((id) => `### ${id} Task ${id}\n\nBuild. Do it.\n\nAcceptance criteria. Works.\n\nVerify. Test.\n`).join('\n');
}

test('dispatches the first task and inits the ledger from tasks.md', () => {
  const dir = planDir({ 'tasks.md': tasksMd(['T-001', 'T-002']) });

  const r = runBin(['--plan', dir]);

  assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
  assert.ok(r.stdout.includes('T-001'), 'expected T-001 in the dispatch message');
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.status, 'running');
  assert.strictEqual(ledger.tasks[0].status, 'in_progress');
  assert.strictEqual(ledger.tasks.length, 2);
});

test('reconciles a resumed ledger against a changed tasks.md before dispatch', () => {
  const dir = planDir({ 'tasks.md': tasksMd(['T-001', 'T-002']) });

  const first = runBin(['--plan', dir]);
  assert.strictEqual(first.status, 0, `expected exit 0, got ${first.status}: ${first.stderr}`);
  assert.ok(first.stdout.includes('T-001'), 'expected T-001 dispatched first');

  // tasks.md changes after the ledger was created: T-002 removed, T-003 added.
  fs.writeFileSync(path.join(dir, 'tasks.md'), tasksMd(['T-001', 'T-003']));

  const second = runBin(['done', '--plan', dir]);

  assert.strictEqual(second.status, 0, `expected exit 0, got ${second.status}: ${second.stderr}`);
  assert.ok(second.stdout.includes('T-003'), 'expected the new T-003 to be dispatched');
  assert.ok(!second.stdout.includes('T-002'), 'expected the removed T-002 to never be dispatched');
  const ledger = readLedger(dir);
  assert.strictEqual(ledger.tasks.length, 2, 'expected the ledger to match the new spec');
  assert.ok(ledger.tasks.some((t) => t.id === 'T-001' && t.status === 'done'), 'expected T-001 recorded done');
  assert.ok(ledger.tasks.some((t) => t.id === 'T-003' && t.status === 'in_progress'), 'expected T-003 in_progress');
  assert.ok(!ledger.tasks.some((t) => t.id === 'T-002'), 'expected T-002 removed from the ledger');
});

test('exits 1 with a clear error when the plan file is missing', () => {
  const dir = tempDir('bin-test-');

  const r = runBin(['--plan', dir]);

  assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.ok(r.stderr.includes('plan file not found'), `expected a plan-file error, got: ${r.stderr}`);
});

test('exits 1 with a clear error when the plan file contains no tasks', () => {
  const dir = planDir({ 'tasks.md': '# No tasks here\n\nJust prose.\n' });

  const r = runBin(['--plan', dir]);

  assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.ok(r.stderr.includes('plan file contains no tasks'), `expected an empty-plan error, got: ${r.stderr}`);
});

test('exits 1 on a corrupt ledger and never replaces it', () => {
  const dir = planDir({ 'tasks.md': tasksMd(['T-001']), 'state.json': '{ not json' });

  const r = runBin(['--plan', dir]);

  assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}`);
  assert.ok(r.stderr.includes('ledger exists but could not be loaded'), `expected a corrupt-ledger error, got: ${r.stderr}`);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'), '{ not json', 'corrupt ledger must be left untouched');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);