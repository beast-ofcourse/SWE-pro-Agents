#!/usr/bin/env node

/**
 * Unit tests for scripts/opencode-config.js (agents-path entry writer).
 *
 * Covers: fresh file creation (no backup), idempotent skip when present,
 * backup before overwrite, unparseable and missing-dir safety, non-object
 * configs rejected. All state lives in throwaway temp dirs.
 *
 * Zero dependencies: node:assert + node:fs + node:os + node:path.
 * Run with: node test/opencode-config.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfg = require('../scripts/opencode-config.js');

let passed = 0;
let failed = 0;

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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const AGENTS_PATH = path.join('~', 'agents', 'swe-pro-agents');

test('missing file is created with the entry (no backup)', () => {
  const dir = tempDir('occ-missing-');
  const file = path.join(dir, 'opencode.json');
  const res = cfg.ensureAgentPathEntry(file, AGENTS_PATH);
  assert.strictEqual(res.outcome, 'written');
  assert.strictEqual(res.backup, null);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(parsed.agents, [{ path: AGENTS_PATH }]);
});

test('existing entry is left untouched', () => {
  const dir = tempDir('occ-present-');
  const file = path.join(dir, 'opencode.json');
  fs.writeFileSync(file, JSON.stringify({ agents: [{ path: AGENTS_PATH }], other: 1 }, null, 2));
  const res = cfg.ensureAgentPathEntry(file, AGENTS_PATH);
  assert.strictEqual(res.outcome, 'present');
  assert.strictEqual(fs.existsSync(file + '.bak'), false, 'no backup when nothing changed');
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.strictEqual(parsed.other, 1);
});

test('overwrite backs up first and preserves other keys', () => {
  const dir = tempDir('occ-backup-');
  const file = path.join(dir, 'opencode.json');
  fs.writeFileSync(file, JSON.stringify({ agents: [], theme: 'dark' }, null, 2));
  const res = cfg.ensureAgentPathEntry(file, AGENTS_PATH);
  assert.strictEqual(res.outcome, 'written');
  assert.strictEqual(res.backup, file + '.bak');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(res.backup, 'utf8')).agents, []);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(parsed.agents, [{ path: AGENTS_PATH }]);
  assert.strictEqual(parsed.theme, 'dark');
});

test('second run is idempotent (no duplicates)', () => {
  const dir = tempDir('occ-idem-');
  const file = path.join(dir, 'opencode.json');
  cfg.ensureAgentPathEntry(file, AGENTS_PATH);
  const res = cfg.ensureAgentPathEntry(file, AGENTS_PATH);
  assert.strictEqual(res.outcome, 'present');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).agents.length, 1);
});

test('unparseable config is left alone', () => {
  const dir = tempDir('occ-broken-');
  const file = path.join(dir, 'opencode.json');
  fs.writeFileSync(file, '{ not json', 'utf8');
  const res = cfg.ensureAgentPathEntry(file, AGENTS_PATH);
  assert.strictEqual(res.outcome, 'unparseable');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), '{ not json');
});

test('non-object config is left alone', () => {
  const dir = tempDir('occ-scalar-');
  const file = path.join(dir, 'opencode.json');
  fs.writeFileSync(file, '"just a string"', 'utf8');
  assert.strictEqual(cfg.ensureAgentPathEntry(file, AGENTS_PATH).outcome, 'unparseable');
});

test('missing directory reports missing-dir without throwing', () => {
  const res = cfg.ensureAgentPathEntry(path.join(tempDir('occ-base-'), 'nope', 'opencode.json'), AGENTS_PATH);
  assert.strictEqual(res.outcome, 'missing-dir');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
