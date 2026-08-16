#!/usr/bin/env node

/**
 * Shared CLI helpers for bin/swe-pro-agents.js and scripts/run-loop.js.
 *
 * The two entry points duplicate these symbols (file-name constants, the
 * stop-reason strings, and the JSON/human output envelope). The --json output
 * shape is a consumer-facing contract, so the envelope lives here once.
 *
 * Zero dependencies: node:process only.
 */

'use strict';

/** Default plan directory (contains tasks.md + state.json). */
const DEFAULT_PLAN_DIR = 'plans';

/** Ledger file name inside the plan directory. */
const LEDGER_FILE = 'state.json';

/** Plan file name inside the plan directory. */
const PLAN_FILE = 'tasks.md';

/**
 * Why shouldContinue() returned false. Presentation only — the gate itself
 * lives in scripts/loop-logic.js.
 */
function stopReason(state) {
  if (state.status !== 'running') return `ledger status is '${state.status}'`;
  if (state.iterations >= state.budget.max_iterations_per_run) return 'iteration budget exhausted';
  if (state.tasks.some((t) => t.status === 'blocked')) return 'a task is blocked';
  return 'no next task';
}

/**
 * Emit output. In jsonMode the machine-readable object goes to stdout and the
 * human lines to stderr; otherwise the human lines go to stdout.
 */
function emit(jsonMode, jsonObj, humanLines) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(jsonObj, null, 2)}\n`);
    for (const line of humanLines) process.stderr.write(`${line}\n`);
  } else {
    for (const line of humanLines) process.stdout.write(`${line}\n`);
  }
}

module.exports = {
  DEFAULT_PLAN_DIR,
  LEDGER_FILE,
  PLAN_FILE,
  stopReason,
  emit,
};