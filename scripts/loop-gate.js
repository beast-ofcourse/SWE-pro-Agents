'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Deep module: LoopGate (goal arming + continuation nudge predicate)
// ---------------------------------------------------------------------------
const LOOP_AGENT = 'swe-pro';
const DISARM_SUBCOMMANDS = new Set(['clear', 'stop', 'off', 'reset', 'none', 'cancel', 'pause']);
const NEUTRAL_SUBCOMMANDS = new Set(['show', 'status', 'help']);
// Standalone goal controls, registered as their own slash commands
// (discoverable in the palette and by remote integrations that list the
// server command catalog). pause_goal always pauses, resume_goal always
// re-arms; their arguments are ignored.
const GOAL_COMMANDS = new Set(['goal', 'pause_goal', 'resume_goal']);

const NUDGE_MESSAGE =
  'Autonomous loop: continue plan execution per plans/state.json. Load and validate the ledger, dispatch the next task, verify it, record the result, and end with <promise>DONE</promise>.';

const armedSessions = new Map();

// Goal records: presence in the map means the session is KNOWN (active or
// paused); absence means never-armed or cleared. Records are ephemeral —
// a restart wipes them, matching the fail-closed arming philosophy. History
// is a bounded audit of transitions, not a durable log.
// Shape: { objective: string|null, status: 'active'|'paused',
//          updatedAt: number, history: [{ t, action }] }
const MAX_TRACKED_GOALS = 200;
const MAX_HISTORY_EVENTS = 50;

function touchRecord(sessionID, action, objective) {
  let record = armedSessions.get(sessionID);
  if (!record) {
    record = { objective: null, status: 'active', updatedAt: 0, history: [] };
    armedSessions.set(sessionID, record);
  }
  if (objective !== undefined) record.objective = objective;
  record.updatedAt = Date.now();
  record.history.push({ t: record.updatedAt, action });
  while (record.history.length > MAX_HISTORY_EVENTS) record.history.shift();
  if (armedSessions.size > MAX_TRACKED_GOALS) {
    let oldestID = null;
    let oldestTime = Infinity;
    for (const [id, rec] of armedSessions) {
      if (rec.updatedAt < oldestTime) {
        oldestTime = rec.updatedAt;
        oldestID = id;
      }
    }
    if (oldestID !== null && oldestID !== sessionID) armedSessions.delete(oldestID);
  }
  return record;
}

// Objective text from /goal arguments: fresh objectives are stored verbatim
// (original casing — matching is case-insensitive, storage is not; review
// M1); subcommand words and empties carry no objective (null = keep existing).
function objectiveFromArgs(raw, action) {
  if (action === 'set') return raw === '' ? null : raw;
  return undefined;
}

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
  if (!GOAL_COMMANDS.has(props.name)) return { handled: false };
  const sessionID = props.sessionID;
  if (!sessionID) return { handled: false };
  if (typeof props.arguments !== 'string') return { handled: false };
  // Subcommand matching is case-insensitive, but stored objectives keep the
  // user's original casing (review M1: lowercasing "Ship The Thing" corrupts
  // what get_goal later reports).
  const raw = props.arguments.trim();
  const args = raw.toLowerCase();
  if (props.name === 'pause_goal') {
    const record = touchRecord(sessionID, 'paused');
    record.status = 'paused';
    return { handled: true, sessionID, armed: false, action: 'paused', raw: args };
  }
  if (props.name === 'resume_goal') {
    touchRecord(sessionID, 'resumed');
    armedSessions.get(sessionID).status = 'active';
    return { handled: true, sessionID, armed: true, action: 'resumed', raw: args };
  }
  if (DISARM_SUBCOMMANDS.has(args)) {
    if (args === 'pause') {
      const record = touchRecord(sessionID, 'paused');
      record.status = 'paused';
      return { handled: true, sessionID, armed: false, action: 'paused', raw: args };
    }
    armedSessions.delete(sessionID);
    return { handled: true, sessionID, armed: false, action: 'cleared', raw: args };
  }
  if (NEUTRAL_SUBCOMMANDS.has(args)) {
    return { handled: true, sessionID, armed: isArmed(sessionID), action: 'shown', raw: args };
  }
  const action = args === '' ? 'armed' : args === 'resume' ? 'resumed' : 'set';
  const record = touchRecord(sessionID, action, objectiveFromArgs(raw, action));
  record.status = 'active';
  return { handled: true, sessionID, armed: true, action, raw: args };
}

function isArmed(sessionID) {
  const record = sessionID ? armedSessions.get(sessionID) : undefined;
  return !!record && record.status === 'active';
}

function explain(sessionID) {
  if (!sessionID) return { armed: false, reason: 'no-session' };
  const record = armedSessions.get(sessionID);
  if (!record) return { armed: false, reason: 'not-armed' };
  if (record.status === 'paused') return { armed: false, reason: 'paused' };
  return { armed: true, reason: 'goal-active' };
}

function shouldNudge({ directory, sessionID, sessionAgent }) {
  try {
    if (sessionAgent !== LOOP_AGENT) return false;
    // Status-aware: paused sessions stay recorded but must never nudge.
    if (!isArmed(sessionID)) return false;
    const state = gateReadState(directory);
    return ledgerResumable(state);
  } catch {
    return false;
  }
}

function resetGate() {
  armedSessions.clear();
}

// ---------------------------------------------------------------------------
// Programmatic goal tools (back the get_goal / set_goal / list_all_goals /
// get_goal_history / update_goal_objective / update_goal_status / clear_goal
// plugin tools). Reads tolerate absence (null / []); writes require presence
// except activation, which mirrors /resume_goal and creates. Everything here
// is ephemeral: a restart wipes all records, same as arming today.
// ---------------------------------------------------------------------------

function requireSessionID(sessionID) {
  if (!sessionID || typeof sessionID !== 'string') {
    throw new Error('goal tools require a sessionID');
  }
  return sessionID;
}

function snapshotGoal(sessionID) {
  const record = armedSessions.get(sessionID);
  if (!record) return null;
  return {
    sessionID,
    armed: record.status === 'active',
    status: record.status,
    objective: record.objective,
    updatedAt: record.updatedAt,
  };
}

/** Arm (or re-arm) a session with an explicit objective. Creates or updates. */
function setGoal(sessionID, objective) {
  requireSessionID(sessionID);
  if (!objective || typeof objective !== 'string' || objective.trim() === '') {
    throw new Error('set_goal requires a non-empty objective string');
  }
  const record = touchRecord(sessionID, 'set', objective.trim());
  record.status = 'active';
  return snapshotGoal(sessionID);
}

/** The session's goal record, or null when the session has none. */
function getGoal(sessionID) {
  if (!sessionID || typeof sessionID !== 'string') return null;
  return snapshotGoal(sessionID);
}

/** Every known session goal, oldest-touched first. */
function listGoals() {
  return [...armedSessions.entries()]
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt)
    .map(([id]) => snapshotGoal(id));
}

/** The session's transition history (bounded), or [] when unknown. */
function getGoalHistory(sessionID) {
  if (!sessionID || typeof sessionID !== 'string') return [];
  const record = armedSessions.get(sessionID);
  if (!record) return [];
  return record.history.map((e) => ({ t: e.t, action: e.action }));
}

/** Replace the objective of a KNOWN session (unknown → throw; use set_goal to create). */
function updateGoalObjective(sessionID, objective) {
  requireSessionID(sessionID);
  if (!armedSessions.get(sessionID)) {
    throw new Error('no goal for session ' + sessionID + ' (use set_goal to create one)');
  }
  if (!objective || typeof objective !== 'string' || objective.trim() === '') {
    throw new Error('update_goal_objective requires a non-empty objective string');
  }
  const record = touchRecord(sessionID, 'objective', objective.trim());
  return snapshotGoal(sessionID);
}

/** Flip a goal between active and paused. Activating an unknown session
 * creates it (mirrors /resume_goal); pausing an unknown session is a no-op
 * returning null. */
function updateGoalStatus(sessionID, status) {
  requireSessionID(sessionID);
  if (status !== 'active' && status !== 'paused') {
    throw new Error('update_goal_status wants "active" or "paused", got ' + JSON.stringify(status));
  }
  if (status === 'active') {
    const record = touchRecord(sessionID, 'resumed');
    record.status = 'active';
    return snapshotGoal(sessionID);
  }
  const record = armedSessions.get(sessionID);
  if (!record) return null;
  const paused = touchRecord(sessionID, 'paused');
  paused.status = 'paused';
  return snapshotGoal(sessionID);
}

/** Forget a session's goal entirely. Returns true when one existed. */
function clearGoal(sessionID) {
  if (!sessionID || typeof sessionID !== 'string') return false;
  return armedSessions.delete(sessionID);
}

module.exports = { LOOP_AGENT, DISARM_SUBCOMMANDS, GOAL_COMMANDS, NUDGE_MESSAGE, handleGoalEvent, isArmed, shouldNudge, explain, reset: resetGate, setGoal, getGoal, listGoals, getGoalHistory, updateGoalObjective, updateGoalStatus, clearGoal, _readState: gateReadState, _shouldResume: ledgerResumable, _stateFile: gateStateFile };
