#!/usr/bin/env node
/**
 * loop-gate.js — Deep LoopGate module for /goal + continuation.
 *
 * One seam, small interface, large hidden implementation:
 *  - Goal parsing (DISARM set, lower-casing, aliases) — locality.
 *  - Per-session armedSessions Map — not a free variable in the plugin.
 *  - Ledger resumability (agent guard + armed + readState + shouldResume) — leverage.
 *
 * Depth: 4 calls hide 3 predicates + fs read + lower-casing + alias set.
 * Deletion test: delete this module → every caller re-implements Map + DISARM + shouldResume.
 * Interface is the test surface — no need to drive fake OpenCode events past it.
 *
 * Zero deps beyond node:fs, node:path and loop-logic's pure predicate (reimplemented
 * locally to avoid installed-layout coupling — plugin cannot require('scripts/loop-logic')
 * in ~/.config/opencode/plugins/ layout). Keep readState private.
 *
 * This module is the CLI's copy of the LoopGate logic (consumed by
 * scripts/ledger.js). The OpenCode plugin (plugins/swe-pro-agents.js) inlines
 * its own copy because plugins can only require sibling files. Tests cross
 * this module's interface directly; plugin tests drive swe-pro-agents.js
 * end-to-end.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const LOOP_AGENT = 'swe-pro';

const DISARM_SUBCOMMANDS = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel', 'pause']);

// Neutral subcommands — inspect state without arming or disarming.
// `show`/`status`/`help` must not arm the session (fixes the MVP arming bug).
const NEUTRAL_SUBCOMMANDS = new Set(['show', 'status', 'help']);

const NUDGE_MESSAGE =
  'Autonomous loop: continue plan execution per plans/state.json. Load and validate the ledger, dispatch the next task, verify it, record the result, and end with <promise>DONE</promise>.';

const armedSessions = new Map();

function stateFile(directory) {
  return path.join(directory, 'plans', 'state.json');
}

function readState(directory) {
  let raw;
  try {
    raw = fs.readFileSync(stateFile(directory), 'utf8');
  } catch {
    return null;
  }
  try {
    const state = JSON.parse(raw);
    return state && typeof state === 'object' ? state : null;
  } catch {
    return null;
  }
}

function shouldResume(state) {
  if (!state || state.status !== 'running') return false;
  if (!Array.isArray(state.tasks)) return false;
  if (state.tasks.some((task) => task && task.status === 'in_progress')) return false;
  return state.tasks.some((task) => task && task.status === 'pending');
}

/**
 * Handle a command.executed event. Mutates armedSessions.
 * Returns { handled, sessionID, armed, action } or { handled:false }.
 * Pure aside from Map mutation — never throws.
 */
function handleGoalEvent(event) {
  const props = (event && event.properties) || {};
  if (props.name !== 'goal') return { handled: false };
  const sessionID = props.sessionID;
  if (!sessionID) return { handled: false };
  if (typeof props.arguments !== 'string') return { handled: false };
  const args = props.arguments.trim().toLowerCase();
  if (DISARM_SUBCOMMANDS.has(args)) {
    armedSessions.delete(sessionID);
    const action = args === 'pause' ? 'paused' : 'cleared';
    return { handled: true, sessionID, armed: false, action, raw: args };
  }
  if (NEUTRAL_SUBCOMMANDS.has(args)) {
    // show/status/help inspect state without arming or disarming
    return { handled: true, sessionID, armed: isArmed(sessionID), action: 'shown', raw: args };
  }

  armedSessions.set(sessionID, true);
  const action = args === '' ? 'armed' : args === 'resume' ? 'resumed' : 'set';
  return { handled: true, sessionID, armed: true, action, raw: args };
}

function isArmed(sessionID) {
  return armedSessions.has(sessionID);
}

function explain(sessionID) {
  if (!sessionID) return { armed: false, reason: 'no-session' };
  if (!armedSessions.has(sessionID)) return { armed: false, reason: 'not-armed' };
  return { armed: true, reason: 'goal-active' };
}

/**
 * Single predicate the adapter calls on session.idle.
 * Returns true only when agent is swe-pro AND session is armed AND ledger is resumable.
 * Never throws — returns false on any error.
 */
function shouldNudge({ directory, sessionID, sessionAgent }) {
  try {
    if (sessionAgent !== LOOP_AGENT) return false;
    if (!sessionID || !armedSessions.has(sessionID)) return false;
    const state = readState(directory);
    return shouldResume(state);
  } catch {
    return false;
  }
}

function reset() {
  armedSessions.clear();
}

module.exports = {
  LOOP_AGENT,
  DISARM_SUBCOMMANDS,
  NUDGE_MESSAGE,
  handleGoalEvent,
  isArmed,
  shouldNudge,
  explain,
  reset,
  // exposed for tests / introspection, not part of public seam
  _readState: readState,
  _shouldResume: shouldResume,
  _stateFile: stateFile,
};
