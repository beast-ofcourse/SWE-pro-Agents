'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Deep module: LoopGate (goal arming + continuation nudge predicate)
// ---------------------------------------------------------------------------
const LOOP_AGENT = 'swe-pro';
const DISARM_SUBCOMMANDS = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel', 'pause']);
const NEUTRAL_SUBCOMMANDS = new Set(['show', 'status', 'help']);

const NUDGE_MESSAGE =
  'Autonomous loop: continue plan execution per plans/state.json. Load and validate the ledger, dispatch the next task, verify it, record the result, and end with <promise>DONE</promise>.';

const armedSessions = new Map();

function gateStateFile(directory) {
  return path.join(directory, 'plans', 'state.json');
}

function gateReadState(directory) {
  let raw;
  try {
    raw = fs.readFileSync(gateStateFile(directory), 'utf8');
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

function ledgerResumable(state) {
  if (!state || state.status !== 'running') return false;
  if (!Array.isArray(state.tasks)) return false;
  if (state.tasks.some((task) => task && task.status === 'in_progress')) return false;
  return state.tasks.some((task) => task && task.status === 'pending');
}

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

function shouldNudge({ directory, sessionID, sessionAgent }) {
  try {
    if (sessionAgent !== LOOP_AGENT) return false;
    if (!sessionID || !armedSessions.has(sessionID)) return false;
    const state = gateReadState(directory);
    return ledgerResumable(state);
  } catch {
    return false;
  }
}

function resetGate() {
  armedSessions.clear();
}

module.exports = { LOOP_AGENT, DISARM_SUBCOMMANDS, NUDGE_MESSAGE, handleGoalEvent, isArmed, shouldNudge, explain, reset: resetGate, _readState: gateReadState, _shouldResume: ledgerResumable, _stateFile: gateStateFile };
