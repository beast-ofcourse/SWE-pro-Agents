#!/usr/bin/env node
/**
 * ledger.js — Deep Ledger module.
 *
 * One seam, small interface, large hidden implementation:
 *  - Atomic persistence (tmp+rename, no .tmp leak) — locality.
 *  - Validation (schema v1, budget, iterations) — locality.
 *  - Resumability (running + !in_progress + pending) — leverage for gate + CLI.
 *  - Sync with spec (add/drop/preserve) — hidden.
 *
 * Depth: 5 calls (open/load/save/init/isResumable) hide 11 pure fns + fs + validation.
 * Deletion test: delete this module → every caller re-implements tmp+rename + validate + shouldResume.
 * Interface is test surface — inject planDir, not fs; tests use temp dirs (future: inject fs adapter).
 *
 * This module is the adapter at the fs seam. Pure core lives in loop-logic.js
 * (tasksFromMarkdown, validateState, nextTask, shouldContinue, etc.) — this
 * module delegates to it and adds I/O.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const logic = require('./loop-logic.js');

let gate;
try {
  gate = require('./loop-gate.js');
} catch {}

function ledgerPath(planDir) {
  return path.join(planDir, 'state.json');
}

/**
 * Load and validate. Returns state or null (never throws) on missing / corrupt / invalid.
 * Contrast: open() throws on corrupt existing file (never silently replaces); isResumable() returns false.
 */
function load(planDir) {
  const p = ledgerPath(planDir);
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = logic.validateState(parsed);
  if (!result.ok) return null;
  return parsed;
}

/**
 * Validate then atomically save (tmp+rename). Throws on invalid state.
 */
function save(planDir, state) {
  const result = logic.validateState(state);
  if (!result.ok) {
    throw new Error(`refusing to save invalid state: ${result.errors.join('; ')}`);
  }
  const p = ledgerPath(planDir);
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, p);
}

/**
 * Create a fresh ledger from tasks and persist it. Returns the new state.
 */
function init(planDir, tasks) {
  const state = logic.initState(tasks);
  save(planDir, state);
  return state;
}

/**
 * Open existing or init fresh. If tasks provided and ledger exists, syncs with spec
 * (add pending, drop orphan, preserve status/attempts) and saves if changed.
 * Throws if file exists but is corrupt/invalid (never silently replaces).
 */
function open(planDir, tasks) {
  const p = ledgerPath(planDir);
  let state = load(planDir);
  if (!state) {
    if (fs.existsSync(p)) {
      throw new Error(`ledger exists but could not be loaded: ${p}`);
    }
    if (!tasks) return null;
    return init(planDir, tasks);
  }
  if (tasks) {
    const synced = logic.syncWithSpec(state, tasks);
    if (synced.added.length > 0 || synced.removed.length > 0) {
      state = synced.state;
      save(planDir, state);
    }
  }
  return state;
}

/**
 * Is the ledger in a state where the gate should nudge?
 * True only when status is running, no task is in_progress, and at least one pending.
 * Never throws — returns false on any error.
 * Delegates to LoopGate's predicate when available (single source of truth — see S2).
 */
function isResumable(planDir) {
  try {
    const state = load(planDir);
    if (!state) return false;
    if (gate && typeof gate._shouldResume === 'function') return gate._shouldResume(state);
    if (state.status !== 'running') return false;
    if (!Array.isArray(state.tasks)) return false;
    if (state.tasks.some((t) => t && t.status === 'in_progress')) return false;
    return state.tasks.some((t) => t && t.status === 'pending');
  } catch {
    return false;
  }
}

function summary(planDir) {
  const state = load(planDir);
  if (!state) return 'no ledger';
  return logic.summary(state);
}

module.exports = {
  ledgerPath,
  load,
  save,
  init,
  open,
  isResumable,
  summary,
  // re-export pure helpers for convenience — callers that need them can use ledger, not loop-logic directly
  validateState: logic.validateState,
  nextTask: logic.nextTask,
  shouldContinue: logic.shouldContinue,
  markInProgress: logic.markInProgress,
  applyAttemptResult: logic.applyAttemptResult,
  syncWithSpec: logic.syncWithSpec,
  buildContinuationMessage: logic.buildContinuationMessage,
  tasksFromMarkdown: logic.tasksFromMarkdown,
  initState: logic.initState,
};
