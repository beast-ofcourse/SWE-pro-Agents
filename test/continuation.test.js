#!/usr/bin/env node

/**
 * Self-tests for plugins/continuation.js.
 *
 * Regression for the review finding that readState() used process.cwd() —
 * the plugin must read plans/state.json relative to the plugin context
 * `directory`, because the plugin process cwd is not the project dir. Each
 * test chdirs to a throwaway dir WITHOUT a plans/state.json and passes a
 * `directory` that HAS one; if the plugin read the cwd, the ledger would be
 * missing and no prompt would fire.
 *
 * Zero dependencies: node:assert + node:fs + node:os + node:path.
 * Run with: node test/continuation.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const plugin = require('../plugins/continuation.js');

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

/** Run one async test; prints the outcome and records pass/fail totals. */
async function test(name, fn) {
  try {
    await fn();
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

/** A fake OpenCode client recording session.prompt calls. */
function fakeClient(calls, agent) {
  return {
    session: {
      get: async () => ({ agent: agent || 'swe-pro' }),
      prompt: async (args) => {
        calls.push(args);
      },
    },
  };
}

/** Fire the plugin's session.idle hook for a session. */
async function fireIdle(directory, client) {
  const hooks = await plugin.server({ client, directory });
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: 'sess-1' } } });
}

/** A resumable ledger: running, no in_progress task, at least one pending. */
function resumableLedger() {
  return JSON.stringify({
    status: 'running',
    tasks: [{ id: 'T-001', status: 'pending' }],
  });
}

// ---------------------------------------------------------------------------

async function main() {
  await test('reads the ledger from the plugin directory, not process.cwd()', async () => {
    const ledgerDir = tempDir('continuation-ledger-');
    fs.mkdirSync(path.join(ledgerDir, 'plans'), { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, 'plans', 'state.json'), resumableLedger());
    const emptyCwd = tempDir('continuation-cwd-');

    const originalCwd = process.cwd();
    process.chdir(emptyCwd);
    try {
      const calls = [];
      await fireIdle(ledgerDir, fakeClient(calls));
      assert.strictEqual(calls.length, 1, 'expected exactly one prompt');
      assert.strictEqual(calls[0].path.id, 'sess-1');
      assert.strictEqual(calls[0].body.agent, 'swe-pro');
      assert.ok(calls[0].body.parts[0].text.includes('Autonomous loop'), 'expected the nudge message');
    } finally {
      process.chdir(originalCwd);
    }
  });

  await test('does not prompt when the ledger in the plugin directory is not resumable', async () => {
    const ledgerDir = tempDir('continuation-ledger-');
    fs.mkdirSync(path.join(ledgerDir, 'plans'), { recursive: true });
    fs.writeFileSync(
      path.join(ledgerDir, 'plans', 'state.json'),
      JSON.stringify({ status: 'done', tasks: [{ id: 'T-001', status: 'done' }] })
    );
    const emptyCwd = tempDir('continuation-cwd-');

    const originalCwd = process.cwd();
    process.chdir(emptyCwd);
    try {
      const calls = [];
      await fireIdle(ledgerDir, fakeClient(calls));
      assert.strictEqual(calls.length, 0, 'expected no prompt for a done ledger');
    } finally {
      process.chdir(originalCwd);
    }
  });

  await test('does not prompt when the plugin directory has no ledger', async () => {
    const emptyDir = tempDir('continuation-empty-');
    const emptyCwd = tempDir('continuation-cwd-');

    const originalCwd = process.cwd();
    process.chdir(emptyCwd);
    try {
      const calls = [];
      await fireIdle(emptyDir, fakeClient(calls));
      assert.strictEqual(calls.length, 0, 'expected no prompt without a ledger');
    } finally {
      process.chdir(originalCwd);
    }
  });

  await test('does not prompt for a non-swe-pro session agent', async () => {
    const ledgerDir = tempDir('continuation-ledger-');
    fs.mkdirSync(path.join(ledgerDir, 'plans'), { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, 'plans', 'state.json'), resumableLedger());
    const emptyCwd = tempDir('continuation-cwd-');

    const originalCwd = process.cwd();
    process.chdir(emptyCwd);
    try {
      const calls = [];
      await fireIdle(ledgerDir, fakeClient(calls, 'architect'));
      assert.strictEqual(calls.length, 0, 'expected no prompt for a non-swe-pro session');
    } finally {
      process.chdir(originalCwd);
    }
  });

  await test('does not prompt when a task is in_progress', async () => {
    const ledgerDir = tempDir('continuation-ledger-');
    fs.mkdirSync(path.join(ledgerDir, 'plans'), { recursive: true });
    fs.writeFileSync(
      path.join(ledgerDir, 'plans', 'state.json'),
      JSON.stringify({
        status: 'running',
        tasks: [
          { id: 'T-001', status: 'in_progress' },
          { id: 'T-002', status: 'pending' },
        ],
      })
    );
    const emptyCwd = tempDir('continuation-cwd-');

    const originalCwd = process.cwd();
    process.chdir(emptyCwd);
    try {
      const calls = [];
      await fireIdle(ledgerDir, fakeClient(calls));
      assert.strictEqual(calls.length, 0, 'expected no prompt while a task is in_progress');
    } finally {
      process.chdir(originalCwd);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main();