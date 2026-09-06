'use strict';

/**
 * swe-pro-agents.js — unified OpenCode plugin.
 *
 * Combines what were four installed plugins into one self-contained file:
 *   - the /goal command + autonomous-loop continuation nudge (session.idle)
 *   - background-subagent delegation (engine + git-worktree isolation)
 *
 * Self-contained on purpose: OpenCode loads plugins from
 * ~/.config/opencode/plugins/ and a plugin file there can only require sibling
 * files, never ../scripts. So the deep logic (LoopGate, delegation engine,
 * worktree manager, feature-flag reader) is inlined here — no cross-file
 * requires, no duplicated sibling copies. Only node builtins are required.
 *
 * Doc-verified OpenCode plugin API (recorded at build time, verified against
 * opencode.ai/docs/plugins and the opencode source, dev branch):
 *   - Plugins export a V1 shape: module.exports = { id, server }.
 *   - server(ctx) returns hooks: { config, event, tool }.
 *   - config.command["goal"] registers the slash command.
 *   - event hook receives { event: { type, properties } }; session.idle carries
 *     properties.sessionID; command.executed carries properties.name/arguments.
 *   - client.session.create / get / prompt / abort / message drive child sessions.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { execFileSync } = require('child_process');

// <swe-pro-generated src="scripts/pack-config.js">
// ---------------------------------------------------------------------------
// Feature flag: /goal enablement (mirrors scripts/pack-config.js isGoalEnabled)
// ---------------------------------------------------------------------------
const GOAL_CONFIG_FILE = 'swe-pro-agents.config.json';

// Global flag lives beside the install manifest (~/.config/swe-pro-agents/),
// written by the installer's component selection ("Goal system" unchecked).
// A project-level flag file, when it states an explicit boolean, always wins;
// the global file applies when the project is silent; default is enabled.
function globalConfigPath() {
  try {
    return path.join(os.homedir(), '.config', 'swe-pro-agents', GOAL_CONFIG_FILE);
  } catch {
    return null;
  }
}

// Read an explicit boolean goal value from a config file path.
// Returns true/false, or undefined when absent, unreadable, or corrupt —
// callers fall through to the next scope on undefined (fail-open default).
function readGoalValue(filePath) {
  if (!filePath || typeof filePath !== 'string') return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const value = parsed && parsed.features && parsed.features.goal;
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}

function loadGoalConfig(directory) {
  const p = directory && typeof directory === 'string' ? path.join(directory, GOAL_CONFIG_FILE) : null;
  if (!p) return { features: { goal: true } };
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return { features: { goal: true } };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { features: { goal: true } };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { features: { goal: true } };
  if (!parsed.features || typeof parsed.features !== 'object') return { features: { goal: true } };
  return parsed;
}

function isGoalEnabled(directory) {
  try {
    const projectPath = directory && typeof directory === 'string'
      ? path.join(directory, GOAL_CONFIG_FILE)
      : null;
    const projectValue = readGoalValue(projectPath);
    if (projectValue !== undefined) return projectValue;
    const globalValue = readGoalValue(globalConfigPath());
    if (globalValue !== undefined) return globalValue;
  } catch {
    /* fall through to fail-open default */
  }
  return true;
}

// CLI-only helpers (consumed by bin/ and tests). They are inlined into the
// generated plugin section too, where they are inert (pure, never called).
const CONFIG_FILE = GOAL_CONFIG_FILE;

function defaultConfig() {
  return { features: { goal: true } };
}

function configPath(directory) {
  if (!directory || typeof directory !== 'string') return null;
  return path.join(directory, CONFIG_FILE);
}

function loadConfig(directory) {
  return loadGoalConfig(directory);
}

// Merge `features` into the project config, preserving other keys. Atomic write.
// Missing/invalid file is treated as the default config before merge.
function writeConfig(directory, features) {
  const p = configPath(directory);
  if (!p) return; // cannot write without a directory

  let existing = {};
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') existing = parsed;
  } catch {}
  const next = { ...existing, features: { ...(existing.features || {}), ...features } };
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

// Merge `features` into the GLOBAL config (beside the install manifest),
// preserving other keys. Atomic write. Used by the installer's component
// selection ("Goal system" unchecked writes { goal: false }).
function writeGlobalConfig(features) {
  const p = globalConfigPath();
  if (!p) return; // cannot resolve a home directory
  let existing = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (parsed && typeof parsed === 'object') existing = parsed;
  } catch {}
  const next = { ...existing, features: { ...(existing.features || {}), ...features } };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}
// </swe-pro-generated>

// <swe-pro-generated src="scripts/loop-gate.js">
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
// </swe-pro-generated>

// <swe-pro-generated src="scripts/background-worktree.js">
// ---------------------------------------------------------------------------
// Deep module: background-worktree (git worktree isolation for write-mode)
// ---------------------------------------------------------------------------
function createWorktreeManager(deps) {
  const execGit =
    deps && typeof deps.execGit === 'function'
      ? deps.execGit
      : (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

  function numOrZero(text) {
    return /^\d+$/.test(String(text).trim()) ? parseInt(text, 10) : 0;
  }

  // Conflict signal per T-024: seven-angle-bracket hunks (+<<<<<<< in
  // diff-style output) or git's CONFLICT summary lines. Narrow enough that
  // normal merge-tree/diff output never matches.
  function hasConflictMarkers(text) {
    return /<<<<<<<|CONFLICT/.test(String(text || ''));
  }

  function gitFailureDetail(err) {
    if (!err) return 'unknown git error';
    const extra = err && (err.stderr || err.stdout);
    const detail = extra ? String(extra).trim() : '';
    const message = err && err.message ? String(err.message) : String(err);
    return detail && message.indexOf(detail) === -1 ? message + ' :: ' + detail : message;
  }

  function branchExists(repoDir, branch) {
    try {
      execGit(['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], repoDir);
      return true;
    } catch {
      return false;
    }
  }

  async function setup(repoDir, id) {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    let branch = 'bg-' + safe;
    let suffix = 0;
    while (branchExists(repoDir, branch)) {
      suffix += 1;
      branch = 'bg-' + safe + '-' + suffix;
    }
    const wtPath = path.join(repoDir, '.worktrees', branch);
    execGit(['worktree', 'add', '-b', branch, wtPath], repoDir);
    return { path: wtPath, branch, repoDir };
  }

  async function remove(worktree) {
    if (!worktree || !worktree.path) return;
    const repo = worktree.repoDir;
    try {
      execGit(['worktree', 'remove', worktree.path], repo);
    } catch {
      execGit(['worktree', 'remove', '--force', worktree.path], repo);
    }
    if (branchExists(repo, worktree.branch)) {
      try {
        execGit(['branch', '-D', worktree.branch], repo);
      } catch {
        /* branch may be undeletable */
      }
    }
  }

  // T-024 check-only merge report (NEVER merges): merge-base of the worktree
  // branch vs HEAD, per-file added/deleted counts via diff --numstat, and a
  // merge-tree probe for the conflict signal. Every git failure surfaces as a
  // contextual Error (never raw, never swallowed); callers treat 'high' as
  // "review before merging" — merging itself stays an explicit human step.
  async function diffReport(repoDir, worktree) {
    if (!repoDir || !worktree || !worktree.branch) {
      throw new Error('diffReport requires repoDir + worktree.branch');
    }
    const branch = String(worktree.branch);
    let base;
    try {
      base = String(execGit(['merge-base', branch, 'HEAD'], repoDir)).trim();
    } catch (err) {
      throw new Error('diffReport: merge-base failed for ' + branch + ': ' + gitFailureDetail(err));
    }
    if (!base) throw new Error('diffReport: empty merge-base for ' + branch);
    let numstat;
    try {
      numstat = String(execGit(['diff', '--numstat', base, branch], repoDir));
    } catch (err) {
      throw new Error('diffReport: diff --numstat failed for ' + branch + ': ' + gitFailureDetail(err));
    }
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of numstat.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length < 3) continue;
      filesChanged += 1;
      insertions += numOrZero(cols[0]);
      deletions += numOrZero(cols[1]);
    }
    let conflictProbability = 'low';
    try {
      const merged = String(execGit(['merge-tree', '--write-tree', base, branch], repoDir));
      if (hasConflictMarkers(merged)) conflictProbability = 'high';
    } catch (err) {
      // merge-tree exits non-zero on conflict: a conflict signal in the
      // failure output means 'high'; any other git failure is rethrown as a
      // contextual Error (never swallowed).
      if (hasConflictMarkers(gitFailureDetail(err))) conflictProbability = 'high';
      else throw new Error('diffReport: merge-tree failed for ' + branch + ': ' + gitFailureDetail(err));
    }
    return { filesChanged, insertions, deletions, conflictProbability, base };
  }

  return { setup, remove, branchExists, diffReport };
}
// </swe-pro-generated>

// <swe-pro-generated src="scripts/background-journal.js">
function createJournal({ storeDir }) {
  function journalFile(id) {
    return path.join(storeDir, id + '.journal.jsonl');
  }

  function append(id, type, payload) {
    fs.appendFileSync(journalFile(id), JSON.stringify({ t: Date.now(), type, payload }) + '\n');
  }

  function replay(id) {
    let raw;
    try {
      raw = fs.readFileSync(journalFile(id), 'utf-8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return [];
      throw err;
    }
    if (!raw) return [];
    const events = [];
    const lines = raw.split('\n');
    for (const line of lines) {
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        // Skip torn tail line after a crash — a partial write must not break recovery.
        continue;
      }
      events.push(event);
    }
    return events;
  }

  function prune(id, maxAgeMs, isTerminal) {
    if (!isTerminal) return;
    const events = replay(id);
    if (events.length === 0) return;
    const newest = events[events.length - 1];
    if (typeof newest.t !== 'number') return;
    if (Date.now() - newest.t <= maxAgeMs) return;
    try {
      fs.unlinkSync(journalFile(id));
    } catch (err) {
      if (err && err.code === 'ENOENT') return;
      throw err;
    }
  }

  return { append, replay, prune };
}
// </swe-pro-generated>

// <swe-pro-generated src="scripts/background-spawner.js">
// ---------------------------------------------------------------------------
// Deep module: background-spawner (session spawner seam + native stub)
// ---------------------------------------------------------------------------

// T-005 pending: TERMINAL_STATES is the ASSUMED live-API terminal enum. The
// T-005 spike against a live OpenCode session may correct it (keep
// 'interrupt' as the synthetic state we add for stale/ttl interrupts).
const TERMINAL_STATES = ['completed', 'error', 'cancelled', 'interrupt'];
const DEFAULT_SESSION_WAIT_MS = 4000;
const SESSION_POLL_INTERVAL_MS = 200;
const DEFAULT_SESSION_TITLE = 'background-delegation';
const NATIVE_SPAWNER_MESSAGE = 'NativeSpawner not implemented in v1';

function unwrap(res) {
  if (res && typeof res === 'object' && res.data !== undefined) return res.data;
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveSessionWaitMs(env, opts) {
  if (opts && typeof opts.waitForSessionStartMs === 'number') return opts.waitForSessionStartMs;
  const raw = env ? env.SWE_PRO_BG_SESSION_WAIT_MS : undefined;
  const parsed = parseInt(raw, 10);
  if (!Number.isNaN(parsed)) return parsed;
  return DEFAULT_SESSION_WAIT_MS;
}

function resolveLastActivityAt(session) {
  const candidates = [session.updatedAt, session.lastActivityAt, session.activityAt, session.lastMessageAt];
  for (const candidate of candidates) {
    if (typeof candidate === 'number') return candidate;
  }
  return null;
}

function createSessionSpawner(deps) {
  if (!deps || !deps.client) throw new Error('createSessionSpawner requires { client }');
  const client = deps.client;
  const env = deps.env || process.env;

  async function waitForSession(childSessionID, waitMs) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      try {
        const found = unwrap(await client.session.get({ path: { id: childSessionID } }));
        if (found) return true;
      } catch {
        // Session not visible yet: keep polling until the deadline below.
      }
      if (Date.now() >= deadline) return false;
      const remaining = deadline - Date.now();
      await sleep(remaining < SESSION_POLL_INTERVAL_MS ? remaining : SESSION_POLL_INTERVAL_MS);
    }
  }

  async function spawn(opts) {
    const request = opts || {};
    const created = unwrap(await client.session.create({ body: { title: request.title || DEFAULT_SESSION_TITLE, parentID: request.parentID || null } }));
    const childSessionID = created && created.id;
    if (!childSessionID) throw new Error('spawn: session.create returned no id');
    const promptBody = { parts: [{ type: 'text', text: request.prompt }] };
    if (request.agent) promptBody.agent = request.agent;
    if (request.model) promptBody.model = request.model;
    client.session.prompt({ path: { id: childSessionID }, body: promptBody }).catch(() => {});
    const sessionStarted = await waitForSession(childSessionID, resolveSessionWaitMs(env, request));
    return { childSessionID, sessionStarted };
  }

  async function getActivity(sessionId) {
    try {
      const session = unwrap(await client.session.get({ path: { id: sessionId } }));
      if (!session) return { state: 'gone', lastActivityAt: null };
      return { state: session.state || session.status, tokens: session.tokens, lastActivityAt: resolveLastActivityAt(session) };
    } catch {
      return { state: 'gone', lastActivityAt: null };
    }
  }

  return { spawn, getActivity };
}

/**
 * NativeSpawner stub — future `manager.launch()` seam (T-033).
 *
 * A future NativeSpawner would implement the same `{ spawn, getActivity }`
 * interface as `createSessionSpawner`, but over `manager.launch()` instead of
 * `client.session`:
 *
 * - `spawn(opts)` would call `manager.launch({ prompt, agent, model, ... })`
 *   and return `{ taskId, sessionId }` (native task id + backing session id),
 *   in place of the session spawner's `{ childSessionID, sessionStarted }`.
 * - `getActivity(sessionId)` would map the native task status onto the shared
 *   activity shape `{ state, tokens, lastActivityAt }`, mapping terminal
 *   native statuses onto `TERMINAL_STATES` (and a vanished task onto `'gone'`),
 *   exactly as `createSessionSpawner().getActivity` does for `session.get`.
 *
 * Swapping is a one-line change: pass the native spawner as `deps.spawner` to
 * `createBackgroundDelegate` (which defaults to `createSessionSpawner`).
 *
 * v1 throws to document the seam — no behavior change.
 */
function createNativeSpawnerStub() {
  function spawn() {
    throw new Error(NATIVE_SPAWNER_MESSAGE);
  }
  function getActivity() {
    throw new Error(NATIVE_SPAWNER_MESSAGE);
  }
  return { spawn, getActivity };
}
// </swe-pro-generated>

// <swe-pro-generated src="scripts/background-results.js">
// ---------------------------------------------------------------------------
// Deep module: background-results (typed result registry + secret redaction)
// ---------------------------------------------------------------------------
const SECRET_PATTERN = /(api[_-]?key|secret|token|password|authorization)["']?\s*[:=]\s*['"]?[^\s'"]+/gi;
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|authorization)/i;
const SUMMARY_MAX_LENGTH = 2000;
const REDACTED_TOKEN = '<redacted>';

const schemas = Object.create(null);

function registerSchema(agent, validate) {
  schemas[agent] = validate;
}

function validateResult(agent, raw) {
  try {
    if (!Object.prototype.hasOwnProperty.call(schemas, agent)) {
      const text = String(raw || '');
      return { kind: 'generic', summary: text.slice(0, SUMMARY_MAX_LENGTH), markdown: text };
    }
    const validate = schemas[agent];
    let outcome;
    try {
      outcome = validate(raw);
    } catch (err) {
      return { kind: 'invalid', error: err && err.message ? err.message : String(err), raw };
    }
    if (outcome && outcome.ok) return { kind: 'typed', value: outcome.value };
    const error = outcome && outcome.error !== undefined ? outcome.error : 'validation failed';
    return { kind: 'invalid', error, raw };
  } catch (err) {
    return { kind: 'invalid', error: err && err.message ? err.message : String(err), raw };
  }
}

function redact(text) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(SECRET_PATTERN, REDACTED_TOKEN);
  } catch {
    return text;
  }
}

function redactDeep(value) {
  try {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map((item) => redactDeep(item));
    if (value !== null && typeof value === 'object') {
      if (value instanceof Date || value instanceof RegExp) return value;
      const out = {};
      for (const key of Object.keys(value)) {
        const prop = value[key];
        if (typeof prop === 'string') out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED_TOKEN : redact(prop);
        else if (Array.isArray(prop)) out[key] = redactDeep(prop);
        else if (prop !== null && typeof prop === 'object' && !(prop instanceof Date) && !(prop instanceof RegExp)) out[key] = redactDeep(prop);
        else out[key] = prop;
      }
      return out;
    }
    return value;
  } catch {
    return value;
  }
}
// </swe-pro-generated>

// <swe-pro-generated src="scripts/background-scheduler.js">
// ---------------------------------------------------------------------------
// Deep module: background-scheduler (per-key concurrency + fair-share)
// ---------------------------------------------------------------------------
const SCHEDULER_DEFAULT_PER_KEY = 5;
const SCHEDULER_DEFAULT_MAX_PARALLEL = 4;
const SCHEDULER_DEFAULT_FAIR_SHARE = 0.75;
const SCHEDULER_DEFAULT_BACKOFF_BASE = 5000;
const SCHEDULER_DEFAULT_BACKOFF_MAX = 120000;
const SCHEDULER_DEFAULT_TOKEN_BUDGET = 200000;
const SCHEDULER_DEFAULT_CB_THRESHOLD = 5;
const RATE_LIMIT_PATTERN = /429|rate.?limit|5\d\d/i;

function keyFor(delegation) {
  const model = delegation ? delegation.model : null;
  const provider = delegation ? delegation.provider : null;
  if (model) {
    const text = String(model);
    if (text.indexOf('/') !== -1) return text;
    if (provider) return String(provider) + '/' + text;
    return text;
  }
  if (provider) return String(provider);
  return 'default';
}

function createScheduler(deps) {
  const env = (deps && deps.env) || process.env;
  const perKeyLimit = parseInt(env.SWE_PRO_BG_PER_KEY, 10) || SCHEDULER_DEFAULT_PER_KEY;
  const maxParallel = parseInt(env.SWE_PRO_BG_MAX_PARALLEL, 10) || SCHEDULER_DEFAULT_MAX_PARALLEL;
  const fairShare = parseFloat(env.SWE_PRO_BG_FAIR_SHARE) || SCHEDULER_DEFAULT_FAIR_SHARE;
  const backoffBase = parseInt(env.SWE_PRO_BG_BACKOFF_BASE, 10) || SCHEDULER_DEFAULT_BACKOFF_BASE;
  const backoffMax = parseInt(env.SWE_PRO_BG_BACKOFF_MAX, 10) || SCHEDULER_DEFAULT_BACKOFF_MAX;
  const tokenBudget = parseInt(env.SWE_PRO_BG_TOKEN_BUDGET, 10) || SCHEDULER_DEFAULT_TOKEN_BUDGET;
  const cbThreshold = parseInt(env.SWE_PRO_BG_CB_THRESHOLD, 10) || SCHEDULER_DEFAULT_CB_THRESHOLD;
  const slots = [];
  const activeByKey = Object.create(null);
  const activeByParent = Object.create(null);
  // T-022 backpressure state (per key, in-memory only):
  // - backoffUntil[key]: Date.now() timestamp until which acquire() refuses
  //   that key with {ok:false, reason:'backoff'} (429-storm: queued tasks wait,
  //   no crash, no silent drop).
  // - backoffAttempts[key]: consecutive rate-limit noteError count for the key.
  //   Exact semantics: incremented on each matching noteError; reset to zero on
  //   the next successful acquire() for that key AND on any noteTokens() call
  //   for that key (successful spawn). The backoff window itself is NOT cleared
  //   early — acquire stays backed off until now >= backoffUntil[key]. Delay
  //   for error N (0-based) is min(base * 2^N, max).
  // - estimatedTokens[key]: accumulated best-effort token estimate per key;
  //   soft only — acquire refuses with {ok:false, reason:'budget'} while over
  //   budget, and the counter resets when the key drains (no active slots left
  //   after release()).
  const backoffUntil = Object.create(null);
  const backoffAttempts = Object.create(null);
  const estimatedTokens = Object.create(null);
  // T-023 spawn circuit breaker (per key, in-memory only):
  // - circuitConsecutive[key]: consecutive spawn failures for the key (any
  //   error, not just rate limits — unlike noteError/backoff). Reset to zero
  //   by noteSpawnSuccess while the circuit is closed.
  // - circuitOpen[key]: true once circuitConsecutive reaches cbThreshold
  //   (env SWE_PRO_BG_CB_THRESHOLD, default 5). While open, acquire() refuses
  //   that key with {ok:false, reason:'circuit_open'} (other keys unaffected).
  // - Half-close (exact): an open circuit admits exactly ONE trial acquire —
  //   the first acquire while open with no trial outstanding passes through
  //   to the normal admission checks and, when admitted, marks
  //   circuitTrialInFlight[key]; any further acquire while the trial is
  //   outstanding returns circuit_open. Trial spawn success
  //   (noteSpawnSuccess) fully closes the circuit AND resets the consecutive
  //   counter (as does any other spawn success while open — a success resets
  //   the key); trial spawn failure (noteSpawnFailure) clears the trial flag
  //   and keeps the circuit open (the next acquire may trial again).
  const circuitConsecutive = Object.create(null);
  const circuitOpen = Object.create(null);
  const circuitTrialInFlight = Object.create(null);

  function normalizeKey(key) {
    return typeof key === 'string' && key ? key : 'default';
  }

  function heldByKey(slotKey) {
    return activeByKey[slotKey] || 0;
  }

  function heldByParent(parentID) {
    return activeByParent[parentID] || 0;
  }

  function acquire(key, parentID) {
    const slotKey = normalizeKey(key);
    const now = Date.now();
    // T-023 circuit breaker: open circuits refuse, except the single
    // half-open trial (first acquire with no trial outstanding falls through
    // to the normal checks below and marks the trial when admitted).
    const circuitIsOpen = !!circuitOpen[slotKey];
    if (circuitIsOpen && circuitTrialInFlight[slotKey]) return { ok: false, reason: 'circuit_open' };
    const circuitTrial = circuitIsOpen && !circuitTrialInFlight[slotKey];
    const until = backoffUntil[slotKey];
    if (typeof until === 'number') {
      if (now < until) return { ok: false, reason: 'backoff' };
      delete backoffUntil[slotKey];
    }
    if ((estimatedTokens[slotKey] || 0) > tokenBudget) return { ok: false, reason: 'budget' };
    if (heldByKey(slotKey) >= perKeyLimit) return { ok: false, reason: 'per_key' };
    if (slots.length >= maxParallel) return { ok: false, reason: 'global' };
    // Fair-share: a single parentID holds at most ceil(maxParallel * fairShare).
    // Accepted tradeoff (T-021): with maxParallel=4 a parent is capped at 3,
    // so a parent can be partially starved while 1 slot stays free — that
    // headroom guarantees other parents can always make progress, and is
    // intended.
    if (parentID !== null && parentID !== undefined) {
      const fairCap = Math.ceil(maxParallel * fairShare);
      if (heldByParent(parentID) >= fairCap) return { ok: false, reason: 'fair_share' };
    }
    slots.push({ key: slotKey, parentID: parentID == null ? null : parentID });
    activeByKey[slotKey] = heldByKey(slotKey) + 1;
    if (parentID !== null && parentID !== undefined) activeByParent[parentID] = heldByParent(parentID) + 1;
    if (backoffAttempts[slotKey]) delete backoffAttempts[slotKey];
    // T-023: this admission is the half-open trial — concurrent acquires stay
    // circuit_open until the trial spawn reports success/failure. Consecutive
    // failure counters reset only via noteSpawnSuccess, never here, so a
    // burst of acquires cannot mask a failing key.
    if (circuitTrial) circuitTrialInFlight[slotKey] = true;
    return { ok: true };
  }

  function noteError(key, err) {
    try {
      const slotKey = normalizeKey(key);
      let message = '';
      try {
        if (err && typeof err.message === 'string') message = err.message;
        else message = String(err);
      } catch {
        message = '';
      }
      if (!RATE_LIMIT_PATTERN.test(message)) return { backedOff: false };
      const attempt = backoffAttempts[slotKey] || 0;
      const delay = Math.min(backoffBase * Math.pow(2, attempt), backoffMax);
      backoffUntil[slotKey] = Date.now() + delay;
      backoffAttempts[slotKey] = attempt + 1;
      return { backedOff: true, retryAfterMs: delay };
    } catch {
      return { backedOff: false };
    }
  }

  function noteTokens(key, n) {
    try {
      const slotKey = normalizeKey(key);
      const count = Number(n);
      if (!Number.isFinite(count) || count <= 0) return { ok: false };
      estimatedTokens[slotKey] = (estimatedTokens[slotKey] || 0) + count;
      if (backoffAttempts[slotKey]) delete backoffAttempts[slotKey];
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // T-023 spawn circuit breaker: every spawn failure counts (unlike
  // noteError, which only backs off rate-limit-shaped messages). At threshold
  // consecutive failures the circuit opens; the delegate calls this from its
  // spawn-failure paths and noteSpawnSuccess on spawn success. Never throws.
  function noteSpawnFailure(key) {
    try {
      const slotKey = normalizeKey(key);
      const consecutive = (circuitConsecutive[slotKey] || 0) + 1;
      circuitConsecutive[slotKey] = consecutive;
      // A failed trial frees the trial slot but keeps the circuit open, so
      // the next acquire may attempt exactly one fresh trial.
      if (circuitTrialInFlight[slotKey]) delete circuitTrialInFlight[slotKey];
      if (consecutive >= cbThreshold) circuitOpen[slotKey] = true;
      return { open: !!circuitOpen[slotKey], consecutive };
    } catch {
      return { open: false, consecutive: 0 };
    }
  }

  // T-023 half-close resolution: a success resets the key. An open circuit
  // fully closes (the half-open trial succeeded, or an in-flight spawn
  // admitted before opening proved the key healthy again) and consecutive
  // counters reset either way — "a success resets it". Never throws.
  function noteSpawnSuccess(key) {
    try {
      const slotKey = normalizeKey(key);
      const wasOpen = !!circuitOpen[slotKey];
      delete circuitOpen[slotKey];
      delete circuitTrialInFlight[slotKey];
      delete circuitConsecutive[slotKey];
      return { closed: wasOpen };
    } catch {
      return { closed: false };
    }
  }

  function release(key, parentID) {
    const slotKey = normalizeKey(key);
    let index = -1;
    for (let i = slots.length - 1; i >= 0; i -= 1) {
      if (slots[i].key !== slotKey) continue;
      if (parentID !== null && parentID !== undefined && slots[i].parentID !== parentID) continue;
      index = i;
      break;
    }
    if (index === -1) return { ok: false };
    const removed = slots.splice(index, 1)[0];
    const keyLeft = heldByKey(removed.key) - 1;
    if (keyLeft <= 0) delete activeByKey[removed.key];
    else activeByKey[removed.key] = keyLeft;
    if (removed.parentID !== null && removed.parentID !== undefined) {
      const parentLeft = heldByParent(removed.parentID) - 1;
      if (parentLeft <= 0) delete activeByParent[removed.parentID];
      else activeByParent[removed.parentID] = parentLeft;
    }
    // Soft budget resets when the key drains: no active slots left for it.
    if (!activeByKey[removed.key] && estimatedTokens[removed.key]) delete estimatedTokens[removed.key];
    return { ok: true };
  }

  function keys() {
    const seen = [];
    for (const slot of slots) {
      if (seen.indexOf(slot.key) === -1) seen.push(slot.key);
    }
    return seen;
  }

  // Crash-recovery hook: drops concurrency accounting only — backoff windows,
  // attempt counters, soft token estimates, and spawn-circuit state are
  // preserved (the supervisor
  // calls reset() every reconcile; wiping throttles there would defeat T-022).
  // The delegate calls reset() at the top of
  // reconcileOrphans, then re-acquires one slot per live running delegation,
  // so a stale in-memory count (e.g. after an unclean restart where the
  // running set was rebuilt from disk) can never pin the global cap forever.
  function reset() {
    slots.length = 0;
    for (const name of Object.keys(activeByKey)) delete activeByKey[name];
    for (const name of Object.keys(activeByParent)) delete activeByParent[name];
  }

  return { acquire, release, keys, reset, keyFor, noteError, noteTokens, noteSpawnFailure, noteSpawnSuccess };
}
// </swe-pro-generated>

// <swe-pro-generated src="scripts/background-dashboard.js">
// ---------------------------------------------------------------------------
// Deep module: background-dashboard (bg_dashboard tree + bg_status --json)
// ---------------------------------------------------------------------------
// Single source for the operator glance views (user-flow Persona 1 Journey B,
// Persona 2): renderTree() is the human tree, toJson() the machine shape with
// a per-item logPath. Both are total — partial/foreign list items degrade to
// '-'/'unknown' placeholders, never throw.
//
// Projection note: listDelegations() projects branch/tokens/createdAt/updatedAt
// (T-034), so branch and age render real values; tokens renders once the
// engine persists a tokens snapshot on heartbeat refresh (evaluateTerminal).


const NO_ACTIVE_DELEGATIONS = 'no active delegations';

function dashboardText(value, fallback) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function dashboardBranch(item) {
  if (item && typeof item.branch === 'string' && item.branch) return item.branch;
  if (item && item.worktree && typeof item.worktree.branch === 'string' && item.worktree.branch) return item.worktree.branch;
  return '-';
}

function dashboardTokens(item) {
  const tokens = item ? item.tokens : undefined;
  if (typeof tokens === 'number' && Number.isFinite(tokens)) return String(tokens);
  if (typeof tokens === 'string' && tokens) return tokens;
  if (tokens && typeof tokens === 'object') {
    const input = typeof tokens.input === 'number' ? tokens.input
      : typeof tokens.inputTokens === 'number' ? tokens.inputTokens : 0;
    const output = typeof tokens.output === 'number' ? tokens.output
      : typeof tokens.outputTokens === 'number' ? tokens.outputTokens : 0;
    if (input || output) return String(input + output);
    if (typeof tokens.total === 'number') return String(tokens.total);
    if (typeof tokens.totalTokens === 'number') return String(tokens.totalTokens);
  }
  return '-';
}

function dashboardAge(item, now) {
  const candidates = item
    ? [item.heartbeatAt, item.updatedAt, item.createdAt]
    : [];
  let stamp = null;
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      stamp = candidate;
      break;
    }
  }
  if (stamp === null) return '-';
  const elapsed = now - stamp;
  if (!Number.isFinite(elapsed) || elapsed < 0) return '0s';
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h';
  return Math.floor(hours / 24) + 'd';
}

function dashboardLine(item, prefix, now) {
  const id = dashboardText(item && item.id, 'unknown');
  const state = dashboardText(item && item.state, 'unknown');
  const agent = dashboardText(item && item.agent, '-');
  return prefix + id + ' [' + state + '] agent:' + agent
    + ' branch:' + dashboardBranch(item)
    + ' tokens:' + dashboardTokens(item)
    + ' age:' + dashboardAge(item, now);
}

function renderTree(list) {
  try {
    if (!Array.isArray(list) || list.length === 0) return NO_ACTIVE_DELEGATIONS;
    const now = Date.now();
    return list.map((item, index) => {
      try {
        const last = index === list.length - 1;
        return dashboardLine(item, last ? '└─ ' : '├─ ', now);
      } catch {
        return '└─ ' + dashboardText(item && item.id, 'unknown') + ' [unknown]';
      }
    }).join('\n');
  } catch {
    return NO_ACTIVE_DELEGATIONS;
  }
}

function dashboardLogPath(id, storeDir) {
  const name = dashboardText(id, 'unknown') + '.log';
  if (typeof storeDir === 'string' && storeDir) return path.join(storeDir, name);
  return name;
}

function dashboardEntry(item, storeDir) {
  try {
    const base = item && typeof item === 'object' && !Array.isArray(item)
      ? Object.assign({}, item)
      : {};
    if (base.id === null || base.id === undefined) base.id = 'unknown';
    else base.id = String(base.id);
    base.logPath = dashboardLogPath(base.id, storeDir);
    return base;
  } catch {
    return { id: 'unknown', logPath: dashboardLogPath('unknown', storeDir) };
  }
}

function toJson(list, storeDir) {
  try {
    if (!Array.isArray(list)) return [];
    return list.map((item) => dashboardEntry(item, storeDir));
  } catch {
    return [];
  }
}
// </swe-pro-generated>

// <swe-pro-generated src="scripts/background-delegate.js">
// (see scripts/background-journal.js region — provides createJournal)
// (see scripts/background-spawner.js region — provides createSessionSpawner, TERMINAL_STATES)
// (see scripts/background-results.js region — provides redact, redactDeep, validateResult)
// (see scripts/background-scheduler.js region — provides createScheduler, keyFor)

// ---------------------------------------------------------------------------
// Deep module: background-delegate (delegation engine)
// ---------------------------------------------------------------------------
const DEFAULT_MAX_PARALLEL = 4;
const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_RETRY_BUDGET = 2;
const DEFAULT_READ_TIMEOUT_MS = 900000;
const DEFAULT_SOFT_GRACE_MS = 3000;
const DEFAULT_JOURNAL_PRUNE_DAYS = 7;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const STORE_DIRNAME = 'swe-pro-delegations';
// T-014 single-flight guard: per-id set prevents overlapping supervisor
// passes from double-finalizing or double-retrying the same delegation.
const processing = new Set();

function resolveStoreDir(env) {
  const e = env || process.env;
  const override = e.SWE_PRO_DELEGATIONS_DIR;
  if (override) return override;
  if (process.platform === 'win32') {
    const local = e.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'opencode', STORE_DIRNAME);
  }
  return path.join(os.homedir(), '.local', 'share', 'opencode', STORE_DIRNAME);
}

function unwrap(res) {
  if (res && typeof res === 'object' && res.data !== undefined) return res.data;
  return res;
}

function delegationPriority(opts) {
  if (opts && opts.model) return 2;
  if (opts && opts.provider) return 1;
  return 0;
}

function createBackgroundDelegate(deps) {
  if (!deps || !deps.client) throw new Error('createBackgroundDelegate requires { client }');
  const { client, directory } = deps;
  const env = deps.env || process.env;
  const storeDir = deps.storeDir || resolveStoreDir(env);
  const maxParallel = parseInt(env.SWE_PRO_BG_MAX_PARALLEL, 10) || DEFAULT_MAX_PARALLEL;
  const maxDepth = parseInt(env.SWE_PRO_BG_MAX_DEPTH, 10) || DEFAULT_MAX_DEPTH;
  // T-023 self-healing: how many times an errored delegation auto-retries
  // before it quarantines (explicit bg_resume only — never auto-retried).
  const retryBudget = parseInt(env.SWE_PRO_BG_RETRY, 10) || DEFAULT_RETRY_BUDGET;
  const worktreeManager = deps.worktreeManager || null;
  const repoDir = deps.repoDir || null;
  const onTerminal = typeof deps.onTerminal === 'function' ? deps.onTerminal : null;
  const journal = deps.journal || createJournal({ storeDir });
  const terminalStates = deps.terminalStates || TERMINAL_STATES;
  const spawner = deps.spawner || createSessionSpawner({ client });
  const redactFn = deps.redact || redact;
  const redactDeepFn = deps.redactDeep || redactDeep;
  const validateFn = deps.validateResult || validateResult;
  const scheduler = deps.scheduler || createScheduler({ env });
  // Admission key (T-021): the canonical keyFor is required from
  // scripts/background-scheduler.js above (in-plugin it resolves from the
  // sibling scheduler region, same module scope).
  function admissionKey(state) {
    return keyFor(state);
  }

  const running = new Set();
  const queue = []; // { id, priority }

  const statePath = (id) => path.join(storeDir, id + '.json');
  const markdownPath = (id) => path.join(storeDir, id + '.md');
  const logFilePath = (id) => path.join(storeDir, String(id) + '.log');

  // T-032 per-task log: <storeDir>/<id>.log receives one secrets-free line per
  // lifecycle transition (via transition() below) plus streamed partials (via
  // the bg_read stream:true wiring in the plugin template). Best-effort and
  // total: every fs/redact failure is swallowed, so logging never breaks a
  // transition or a read. Messages pass through redactFn, so even raw child
  // partials land secrets-free (redact is total and idempotent — re-redacting
  // the already-redacted transition summary is a no-op).
  function logPath(id) {
    return logFilePath(id);
  }
  function logEvent(id, msg) {
    try {
      if (id === null || id === undefined || id === '') return;
      const raw = typeof msg === 'string' ? msg : String(msg === null || msg === undefined ? '' : msg);
      let line = raw;
      try {
        line = redactFn(raw);
      } catch {
        line = raw;
      }
      ensureStore();
      fs.appendFileSync(logFilePath(id), '[' + new Date().toISOString() + '] ' + line + '\n');
    } catch {
      /* per-task log is best-effort; never break the caller */
    }
  }

  function ensureStore() {
    fs.mkdirSync(storeDir, { recursive: true, mode: 0o700 });
  }

  function readState(id) {
    try {
      return JSON.parse(fs.readFileSync(statePath(id), 'utf-8'));
    } catch {
      return null;
    }
  }

  // Parent resolution (review M1): opts.parentID may be a delegation id
  // (direct API/tests) or a SESSION id (bg_delegate passes toolCtx.sessionID),
  // while states are keyed by bg_uuid. Try a direct read first; otherwise scan
  // states for a matching childSessionID. Unresolved → null (the child is then
  // treated as a depth-1 root). Scan is guarded throughout — a missing or
  // corrupt store never throws here.
  function readParentState(parentID) {
    if (!parentID) return null;
    const direct = readState(parentID);
    if (direct) return direct;
    let files = [];
    try {
      ensureStore();
      files = fs.readdirSync(storeDir).filter((f) => f.endsWith('.json'));
    } catch {
      return null;
    }
    for (const f of files) {
      let st = null;
      try {
        st = JSON.parse(fs.readFileSync(path.join(storeDir, f), 'utf-8'));
      } catch {
        continue;
      }
      if (st && st.childSessionID === parentID) return st;
    }
    return null;
  }

  function writeState(state) {
    state.updatedAt = Date.now();
    // T-013: redact secrets at the persist boundary. Only the free-text
    // fields are redacted — id, childSessionID, and paths are never touched.
    // redact is total (non-strings pass through unchanged), so no guards.
    state.summary = redactFn(state.summary);
    state.title = redactFn(state.title);
    // T-031 prompt exemption: state.prompt persists VERBATIM (see
    // createDelegation) so bg_resume can re-spawn with the original
    // instruction + [Resume context]. Only the free-text title/summary above
    // are redacted — never the prompt.
    const target = statePath(state.id);
    const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomUUID().slice(0, 8);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, target);
  }

  // T-020: every lifecycle state change goes through transition() so each
  // write produces exactly one redacted journal line. Future tasks adding new
  // transitions must use transition() — never call writeState() directly for
  // a lifecycle change (writeState stays the raw persist: updatedAt + redact).
  function transition(state, type, payload) {
    writeState(state);
    journal.append(state.id, type, redactDeepFn(payload || {}));
    // T-032: every transition appends one secrets-free line to <id>.log — the
    // event type + the already-redacted state.summary only, never raw payloads
    // (payloads may carry partials/prompts; summary passed through writeState's
    // redact just above, and logEvent re-redacts defensively).
    logEvent(state.id, type + (state.summary ? ' ' + state.summary : ''));
  }

  async function fetchChildResult(childSessionID) {
    if (!childSessionID || !client.session || !client.session.messages) return '';
    try {
      const res = unwrap(await client.session.messages({ path: { id: childSessionID } }));
      const msgs = Array.isArray(res) ? res : res && res.messages ? res.messages : [];
      const parts = [];
      for (const m of msgs) {
        if (!m || (m.role !== 'assistant' && m.type !== 'assistant')) continue;
        if (typeof m.content === 'string') parts.push(m.content);
        else if (Array.isArray(m.content)) {
          for (const c of m.content) if (c && c.type === 'text') parts.push(c.text);
        } else if (typeof m.text === 'string') parts.push(m.text);
      }
      return parts.join('\n').trim();
    } catch {
      return '';
    }
  }

  async function spawnDelegation(id, opts) {
    // T-022 throttle key: same canonical key the scheduler admits on, so a
    // spawn failure backs off exactly the key queued tasks wait on.
    let throttleKey = 'default';
    try {
      throttleKey = admissionKey(opts || {});
    } catch {
      throttleKey = 'default';
    }
    let childID = null;
    try {
      const createArgs = { body: { title: opts.title || 'background-delegation', parentID: opts.parentID } };
      if (opts.directory) createArgs.query = { directory: opts.directory };
      const child = unwrap(await client.session.create(createArgs));
      childID = child && child.id;
      if (!childID) throw new Error('spawnDelegation: session.create returned no id');

      const promptBody = { parts: [{ type: 'text', text: opts.prompt }] };
      if (opts.agent) promptBody.agent = opts.agent;
      if (opts.model) promptBody.model = opts.model;
      client.session.prompt({ path: { id: childID }, body: promptBody }).catch(() => {});
    } catch (err) {
      try {
        if (scheduler && typeof scheduler.noteError === 'function') scheduler.noteError(throttleKey, err);
      } catch {
        /* throttle bookkeeping never breaks spawning */
      }
      // T-023: every spawn failure counts toward the scheduler's spawn
      // circuit breaker (any error shape, not just rate limits).
      try {
        if (scheduler && typeof scheduler.noteSpawnFailure === 'function') scheduler.noteSpawnFailure(throttleKey);
      } catch {
        /* circuit bookkeeping never breaks spawning */
      }
      throw err;
    }
    // T-022 best-effort token estimate: real input+output when getActivity
    // reports tokens, else ceil(promptLength/4). Guarded throughout —
    // estimation must never throw or break spawning.
    try {
      let estimate = 0;
      try {
        const activity = await spawner.getActivity(childID);
        const tokens = activity && activity.tokens;
        if (tokens && typeof tokens === 'object') {
          const input = typeof tokens.input === 'number' ? tokens.input
            : typeof tokens.inputTokens === 'number' ? tokens.inputTokens : 0;
          const output = typeof tokens.output === 'number' ? tokens.output
            : typeof tokens.outputTokens === 'number' ? tokens.outputTokens : 0;
          const total = typeof tokens.total === 'number' ? tokens.total
            : typeof tokens.totalTokens === 'number' ? tokens.totalTokens : 0;
          if (input || output) estimate = input + output;
          else if (total) estimate = total;
          else estimate = Math.ceil(String((opts && opts.prompt) || '').length / 4);
        } else if (typeof tokens === 'number' && Number.isFinite(tokens) && tokens > 0) {
          estimate = tokens;
        } else {
          estimate = Math.ceil(String((opts && opts.prompt) || '').length / 4);
        }
      } catch {
        estimate = Math.ceil(String((opts && opts.prompt) || '').length / 4);
      }
      if (Number.isFinite(estimate) && estimate > 0) {
        try {
          if (scheduler && typeof scheduler.noteTokens === 'function') scheduler.noteTokens(throttleKey, estimate);
        } catch {
          /* throttle bookkeeping never breaks spawning */
        }
      }
    } catch {
      /* estimation never breaks spawning */
    }
    // T-023: spawn success half-closes/resets the scheduler's spawn circuit
    // breaker for this key (a trial success fully closes it).
    try {
      if (scheduler && typeof scheduler.noteSpawnSuccess === 'function') scheduler.noteSpawnSuccess(throttleKey);
    } catch {
      /* circuit bookkeeping never breaks spawning */
    }
    return childID;
  }

  async function startDelegation(id, spawnOverrides) {
    const state = readState(id);
    if (!state) throw new Error('startDelegation: unknown id ' + id);
    if (state.state === 'running' || state.state === 'completed' || state.state === 'error' || state.state === 'cancelled' || state.state === 'interrupt') return;
    running.add(id);
    try {
      // T-031: resumeDelegation passes { prompt, directory } overrides so the
      // child receives the augmented resume prompt + worktree dir WITHOUT
      // persisting either over the stored originals (re-resumes never stack
      // context). All existing callers omit the second arg (spawn from state).
      const spawnOpts = spawnOverrides && typeof spawnOverrides === 'object'
        ? Object.assign({}, state, spawnOverrides)
        : state;
      const childID = await spawnDelegation(id, spawnOpts);
      state.childSessionID = childID;
      state.state = 'running';
      transition(state, 'running', { childSessionID: childID });
    } catch (err) {
      running.delete(id);
      throw err;
    }
  }

  // T-021: the scheduler owns admission. Scan the priority-ordered queue for
  // the first admittable entry (head-of-line blocking on one key must not idle
  // a free global slot); dead entries (missing/terminal state) are dropped.
  // One admission per call preserves the existing single-start pacing.
  async function dequeue() {
    for (let i = 0; i < queue.length; i += 1) {
      const entry = queue[i];
      const st = readState(entry.id);
      if (!st) {
        queue.splice(i, 1);
        i -= 1;
        continue;
      }
      if (st.state === 'completed' || st.state === 'error' || st.state === 'cancelled' || st.state === 'interrupt') {
        queue.splice(i, 1);
        i -= 1;
        continue;
      }
      const admission = scheduler.acquire(admissionKey(st), st.parentID || null);
      if (!admission.ok) continue;
      queue.splice(i, 1);
      try {
        await startDelegation(entry.id);
      } catch {
        scheduler.release(admissionKey(st), st.parentID || null);
        const cur = readState(entry.id);
        if (cur) {
          cur.state = 'error';
          cur.summary = 'failed to start';
          transition(cur, 'error', { summary: cur.summary, childSessionID: cur.childSessionID });
        }
        running.delete(entry.id);
      }
      return;
    }
  }

  async function createDelegation(opts = {}) {
    ensureStore();
    // Depth via resolved parent (delegation id or session id); an unresolved
    // parentID means an unknown parent — the child starts as a depth-1 root
    // rather than inheriting a phantom depth.
    const resolvedParent = opts.parentID ? readParentState(opts.parentID) : null;
    const parentDepth = resolvedParent ? (resolvedParent.depth || 1) : 0;
    if (parentDepth + 1 > maxDepth) throw new Error('maxDepth exceeded');
    const delegationDepth = opts.parentID ? parentDepth + 1 : 1;
    const id = 'bg_' + crypto.randomUUID();
    let worktree = null;
    let spawnDir = opts.directory || directory || null;
    if (opts.mode === 'worktree') {
      if (!worktreeManager || !repoDir) throw new Error('worktree mode requires worktreeManager + repoDir');
      worktree = await worktreeManager.setup(repoDir, id);
      spawnDir = worktree.path;
    }
    const state = {
      id,
      state: 'registered',
      // T-031: persist the original prompt VERBATIM (functional necessity for
      // bg_resume, which re-spawns with prompt + [Resume context] — and it is
      // also what startDelegation hands to spawnDelegation, which reads
      // opts.prompt from this state). Deliberately EXCLUDED from T-013
      // redaction in writeState (title/summary only): a redacted prompt would
      // inject REDACTED text into the resumed child. Tradeoff: prompts may
      // contain secrets that now rest in the state file — accepted because the
      // store dir is 0700 and resume fidelity needs the verbatim prompt. The
      // full prompt is never journaled (the resume payload carries only the
      // summary, redacted by construction via transition()).
      prompt: opts.prompt || '',
      title: opts.title || '',
      summary: '',
      agent: opts.agent || null,
      mode: opts.mode || 'readonly',
      model: opts.model || null,
      provider: opts.provider || null,
      parentID: opts.parentID || null,
      directory: spawnDir,
      worktree,
      childSessionID: null,
      priority: delegationPriority(opts),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      heartbeatAt: null,
      budget: { maxTokens: opts.maxTokens || null, maxToolCalls: opts.maxToolCalls || null },
      capabilities: opts.capabilities || null,
      depth: delegationDepth,
      rootSessionId: opts.rootSessionID || opts.parentID || null,
      staleTimeoutMs: opts.staleTimeoutMs || (parseInt(env.SWE_PRO_BG_STALE_MS, 10) || 2700000),
      ttlMs: opts.ttlMs || (parseInt(env.SWE_PRO_BG_TTL_MS, 10) || 1800000),
      admissionTimeoutMs: opts.admissionTimeoutMs || (parseInt(env.SWE_PRO_BG_ADMIT_MS, 10) || 300000),
      journalPath: path.join(storeDir, id + '.journal.jsonl'),
      children: [],
      retryCount: 0,
      quarantined: false,
    };
    transition(state, 'registered', { title: state.title, agent: state.agent, parentID: state.parentID });
    // Children wiring uses the SAME resolved parent as the depth computation
    // above (session ids resolve via childSessionID match) so cascade cancel
    // works for bg_delegate-created trees, not just direct-API ones.
    if (resolvedParent) {
      if (!Array.isArray(resolvedParent.children)) resolvedParent.children = [];
      if (!resolvedParent.children.includes(id)) resolvedParent.children.push(id);
      // Parent bookkeeping only — not a lifecycle transition of the parent,
      // so no journal line here.
      writeState(resolvedParent);
    }

    try {
      const admission = scheduler.acquire(admissionKey(state), state.parentID || null);
      if (admission.ok) {
        await startDelegation(id);
      } else {
        queue.push({ id, priority: state.priority });
        queue.sort((a, b) => b.priority - a.priority);
      }
    } catch (err) {
      scheduler.release(admissionKey(state), state.parentID || null);
      if (worktree && worktreeManager) {
        try {
          await worktreeManager.remove(worktree);
        } catch {
          /* best-effort */
        }
      }
      state.state = 'error';
      state.summary = 'failed to start: ' + (err && err.message ? err.message : String(err));
      transition(state, 'error', { summary: state.summary, childSessionID: state.childSessionID });
      throw err;
    }
    return id;
  }

  // T-030 typed results: validate the (already redacted) markdown at the
  // finalize boundary. validateResult never throws for the real registry, but
  // an injected deps.validateResult is arbitrary — guard anyway and land
  // `invalid` rather than breaking finalization.
  function safeValidateResult(agent, redactedMarkdown) {
    try {
      return validateFn(agent, redactedMarkdown);
    } catch (err) {
      return { kind: 'invalid', error: err && err.message ? err.message : String(err), raw: redactedMarkdown };
    }
  }

  // T-030 readable serialization: prefer the validated markdown/summary for
  // readability; typed values without markdown serialize their value; invalid
  // results fall back to the raw text. Never throws — readDelegation keeps its
  // terminal:/timeout: string contracts for non-completed outcomes.
  function serializeValidated(validated, fallbackMarkdown) {
    try {
      if (validated && typeof validated.markdown === 'string' && validated.markdown) return validated.markdown;
      if (validated && typeof validated.summary === 'string' && validated.summary) return validated.summary;
      if (validated && validated.kind === 'typed') {
        const typedValue = validated.value;
        if (typeof typedValue === 'string') return typedValue;
        if (typedValue !== undefined) {
          try {
            return JSON.stringify(typedValue);
          } catch {
            /* fall through to the raw/JSON fallbacks below */
          }
        }
      }
      if (validated && typeof validated.raw === 'string' && validated.raw) return validated.raw;
      if (validated !== undefined) {
        try {
          const encoded = JSON.stringify(validated);
          if (typeof encoded === 'string' && encoded) return encoded;
        } catch {
          /* fall through to the fallback below */
        }
      }
    } catch {
      /* serialization never breaks the read */
    }
    return fallbackMarkdown || '';
  }

  async function finalizeDelegation(id, resultMarkdown) {
    const state = readState(id);
    if (!state) throw new Error('finalizeDelegation: unknown id ' + id);
    if (state.state === 'completed' || state.state === 'error' || state.state === 'cancelled' || state.state === 'interrupt') {
      return state;
    }
    // T-013: redact the markdown at the persist boundary, before writing
    // the .md file and before deriving the summary from it.
    const redactedMarkdown = redactFn(resultMarkdown);
    fs.writeFileSync(markdownPath(id), redactedMarkdown || '');
    // T-030: validate at the boundary and persist the typed/generic/invalid
    // object alongside the markdown. The input is already redacted, and the
    // validated object passes through redactDeepFn before persist, so the
    // T-013 redacted-summary path still applies to everything stored here
    // (state.summary is redacted again by writeState via transition below).
    const validated = safeValidateResult(state.agent, redactedMarkdown);
    state.result = redactDeepFn(validated);
    state.state = 'completed';
    state.summary = (redactedMarkdown || '').split('\n')[0].slice(0, 120);
    transition(state, 'completed', { summary: state.summary, childSessionID: state.childSessionID });
    if (onTerminal) onTerminal(id, state);
    running.delete(id);
    scheduler.release(admissionKey(state), state.parentID || null);
    const fi = queue.findIndex((q) => q.id === id);
    if (fi !== -1) queue.splice(fi, 1);
    await dequeue();
    return state;
  }

  // Cascade cancel (T-012): stop self, then recursively stop every child in
  // state.children (populated by T-004). No cycle guard: children trees are
  // depth-capped at 2 by T-011's maxDepth, so the recursion is bounded.
  // opts = { signal: 'hard'|'soft', keep: false, reason: null }.
  // signal 'soft' steers the child ([stop after current step]) then aborts
  // after SWE_PRO_BG_SOFT_GRACE_MS (default 3000); 'hard' aborts immediately.
  // keep:true + mode 'worktree' skips worktreeManager.remove (Journey F).
  // reason overrides state.summary; the abort itself always lands 'cancelled'
  // (callers such as enforceCapabilities re-mark error afterwards).
  async function stopDelegation(id, opts = {}) {
    const signal = opts && opts.signal === 'soft' ? 'soft' : 'hard';
    const keep = !!(opts && opts.keep);
    const reason = opts && opts.reason != null ? opts.reason : null;
    const state = readState(id);
    if (!state) throw new Error('stopDelegation: unknown id ' + id);
    // Review M2: terminal states are returned untouched — stopping a completed
    // delegation must not abort (child gone), must not remove its worktree
    // (operator's inspection copy), and must not rewrite its outcome.
    if (state.state === 'completed' || state.state === 'error' || state.state === 'cancelled' || state.state === 'interrupt') {
      return state;
    }
    if (signal === 'soft' && state.childSessionID && client.session && typeof client.session.prompt === 'function') {
      try {
        await client.session.prompt({
          path: { id: state.childSessionID },
          body: { parts: [{ type: 'text', text: '[stop after current step] Please stop work after your current step; the delegation is being cancelled.' }] },
        });
      } catch {
        /* steer is best-effort; abort still follows */
      }
      const graceMs = parseInt(env.SWE_PRO_BG_SOFT_GRACE_MS, 10) || DEFAULT_SOFT_GRACE_MS;
      await new Promise((r) => setTimeout(r, graceMs));
    }
    if (state.childSessionID && client.session && client.session.abort) {
      try {
        await client.session.abort({ path: { id: state.childSessionID } });
      } catch {
        /* child may already be gone */
      }
    }
    const skipWorktreeRemove = keep && state.mode === 'worktree';
    if (!skipWorktreeRemove && state.mode === 'worktree' && state.worktree && worktreeManager) {
      try {
        await worktreeManager.remove(state.worktree);
      } catch {
        /* best-effort */
      }
    }
    state.state = 'cancelled';
    state.cancelSignal = signal;
    state.summary = reason || state.summary;
    transition(state, 'cancelled', { signal, summary: state.summary, childSessionID: state.childSessionID });
    if (onTerminal) onTerminal(id, state);
    running.delete(id);
    scheduler.release(admissionKey(state), state.parentID || null);
    const si = queue.findIndex((q) => q.id === id);
    if (si !== -1) queue.splice(si, 1);
    await dequeue();
    const childIDs = Array.isArray(state.children) ? state.children : [];
    for (const childID of childIDs) {
      if (!readState(childID)) continue;
      await stopDelegation(childID, opts);
    }
    return state;
  }

  async function childIsComplete(childSessionID) {
    if (!childSessionID) return false;
    try {
      const activity = await spawner.getActivity(childSessionID);
      const st = activity && activity.state;
      if (st === 'gone') return true;
      return terminalStates.indexOf(st) !== -1;
    } catch {
      return false;
    }
  }

  // Layered terminal detection (T-010): admission timeout for never-admitted
  // scheduled AND queued-registered tasks, heartbeat-stale interrupt, session-gone error, and whole-
  // delegation ttl interrupt. A null lastActivityAt (spawner found no real
  // timestamp field) disables ONLY the stale leg — ttl still applies — so we
  // never false-interrupt a live child. Refreshes heartbeatAt from the live
  // activity BEFORE the stale check. Returns the terminal state on transition,
  // null when the delegation is still live. Caller treats the result as
  // terminal (interrupt/error) or keeps polling.
  async function evaluateTerminal(id) {
    const state = readState(id);
    if (!state) return null;
    if (state.state !== 'scheduled' && state.state !== 'registered' && state.state !== 'running') return null;
    const now = Date.now();
    const staleTimeoutMs = typeof state.staleTimeoutMs === 'number'
      ? state.staleTimeoutMs
      : (parseInt(env.SWE_PRO_BG_STALE_MS, 10) || 2700000);
    const ttlMs = typeof state.ttlMs === 'number'
      ? state.ttlMs
      : (parseInt(env.SWE_PRO_BG_TTL_MS, 10) || 1800000);
    const admissionTimeoutMs = typeof state.admissionTimeoutMs === 'number'
      ? state.admissionTimeoutMs
      : (parseInt(env.SWE_PRO_BG_ADMIT_MS, 10) || 300000);
    // Review M3: queued delegations stay `registered` (no `scheduled` write
    // exists) with no child yet — they must reach this leg or admission
    // timeouts never fire. The !childSessionID qualifier keeps admitted
    // delegations on the heartbeat/ttl legs below.
    if ((state.state === 'scheduled' || (state.state === 'registered' && !state.childSessionID))
      && now - state.createdAt > admissionTimeoutMs) {
      state.state = 'error';
      state.summary = 'admission_failed';
      transition(state, 'error', { summary: state.summary, childSessionID: state.childSessionID });
      running.delete(id);
      scheduler.release(admissionKey(state), state.parentID || null);
      removeFromQueue(id);
      await dequeue();
      return state;
    }
    let activity = null;
    if (state.childSessionID) {
      try {
        activity = await spawner.getActivity(state.childSessionID);
      } catch {
        activity = null;
      }
    }
    const prevHeartbeat = state.heartbeatAt;
    const prevTokens = state.tokens ? state.tokens.input + ':' + state.tokens.output : null;
    if (activity && typeof activity.lastActivityAt === 'number') {
      state.heartbeatAt = activity.lastActivityAt;
    }
    // Tokens snapshot for dashboard observability (T-034): numbers only, never
    // throw — the activity shape is spawner-dependent and may be absent live.
    if (activity && activity.tokens && typeof activity.tokens === 'object') {
      const tokensIn = activity.tokens.input;
      const tokensOut = activity.tokens.output;
      if (typeof tokensIn === 'number' || typeof tokensOut === 'number') {
        state.tokens = {
          input: typeof tokensIn === 'number' ? tokensIn : 0,
          output: typeof tokensOut === 'number' ? tokensOut : 0,
        };
      }
    }
    if (activity && activity.state === 'gone') {
      state.state = 'error';
      state.summary = 'session_gone';
      transition(state, 'error', { summary: state.summary, childSessionID: state.childSessionID });
      running.delete(id);
      scheduler.release(admissionKey(state), state.parentID || null);
      removeFromQueue(id);
      await dequeue();
      return state;
    }
    if (state.state === 'running'
      && activity && typeof activity.lastActivityAt === 'number'
      && now - activity.lastActivityAt > staleTimeoutMs) {
      state.state = 'interrupt';
      state.interruptReason = 'stale';
      state.summary = 'stale';
      transition(state, 'interrupt', { reason: 'stale', summary: state.summary, childSessionID: state.childSessionID });
      running.delete(id);
      scheduler.release(admissionKey(state), state.parentID || null);
      removeFromQueue(id);
      await dequeue();
      return state;
    }
    if (now - state.createdAt > ttlMs) {
      state.state = 'interrupt';
      state.interruptReason = 'ttl';
      state.summary = 'ttl';
      transition(state, 'interrupt', { reason: 'ttl', summary: state.summary, childSessionID: state.childSessionID });
      running.delete(id);
      scheduler.release(admissionKey(state), state.parentID || null);
      removeFromQueue(id);
      await dequeue();
      return state;
    }
    const nextTokens = state.tokens ? state.tokens.input + ':' + state.tokens.output : null;
    if (state.heartbeatAt !== prevHeartbeat || nextTokens !== prevTokens) writeState(state); // observability refresh only — not a lifecycle transition, so no journal line.
    return null;
  }

  function removeFromQueue(id) {
    const qi = queue.findIndex((q) => q.id === id);
    if (qi !== -1) queue.splice(qi, 1);
  }

  // T-030 streaming: when onPartial is a function, each poll reports the
  // current fetchChildResult(state.childSessionID) partial (best-effort, may
  // be empty early). Each onPartial call is guarded so a throwing callback
  // never breaks the read.
  async function readDelegation(id, timeoutMs = DEFAULT_READ_TIMEOUT_MS, onPartial) {
    const start = Date.now();
    const wantsPartial = typeof onPartial === 'function';
    function emitPartial(partial) {
      if (!wantsPartial) return;
      try {
        onPartial(partial);
      } catch {
        /* a throwing streaming callback never breaks the read */
      }
    }
    while (Date.now() - start < timeoutMs) {
      const state = readState(id);
      if (!state) throw new Error('readDelegation: unknown id ' + id);
      if (state.state === 'completed') {
        let markdown = '';
        try {
          markdown = fs.readFileSync(markdownPath(id), 'utf-8');
        } catch {
          markdown = '';
        }
        // Prefer the persisted typed result; backfill-validate for state
        // files written before T-030 (no state.result yet).
        const validated = state.result || safeValidateResult(state.agent, markdown);
        return serializeValidated(validated, markdown);
      }
      if (state.state === 'interrupt') {
        return 'terminal: interrupt' + (state.interruptReason ? ': ' + state.interruptReason : '');
      }
      if (state.state === 'error' || state.state === 'cancelled') {
        return 'terminal: ' + state.state + (state.summary ? ': ' + state.summary : '');
      }
      const terminal = await evaluateTerminal(id);
      if (terminal) {
        if (terminal.state === 'interrupt') {
          return 'terminal: interrupt' + (terminal.interruptReason ? ': ' + terminal.interruptReason : '');
        }
        return 'terminal: ' + terminal.state + (terminal.summary ? ': ' + terminal.summary : '');
      }
      const fresh = readState(id);
      if (!fresh) throw new Error('readDelegation: unknown id ' + id);
      if (fresh.childSessionID && (await childIsComplete(fresh.childSessionID))) {
        const result = await fetchChildResult(fresh.childSessionID);
        const finalized = await finalizeDelegation(id, result || '(no result captured)');
        return serializeValidated(finalized.result, result || '(no result captured)');
      }
      // Streaming emission: the current partial, best-effort (empty when the
      // child has produced nothing yet or has no session). fetchChildResult
      // is total, and emitPartial guards the callback — emission never breaks
      // the poll.
      try {
        emitPartial(await fetchChildResult(fresh.childSessionID));
      } catch {
        /* emission never breaks the poll */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    return 'timeout: still running';
  }

  async function listDelegations() {
    ensureStore();
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith('.json'));
    const out = [];
    for (const f of files) {
      const st = readState(f.replace('.json', ''));
      if (!st) continue;
      // T-034 additive projection (T-032 deferred wiring): branch/tokens/
      // timestamps feed bg_dashboard + bg_status --json + bg_list (Journey B).
      // tokens is the last known stored value only — null when nothing stored
      // it (no polling here; polling lives in getActivity/evaluateTerminal).
      out.push({
        id: st.id,
        state: st.state,
        title: st.title,
        summary: st.summary,
        agent: st.agent,
        mode: st.mode,
        childSessionID: st.childSessionID || null,
        branch: st.worktree && st.worktree.branch ? st.worktree.branch : null,
        tokens: st.tokens != null ? st.tokens : null,
        createdAt: st.createdAt || null,
        updatedAt: st.updatedAt || null,
      });
    }
    return out;
  }

  // NEVER auto-merge (Journey D + plan non-goal #8): mergeCheck is check-only.
  // It reports diff/conflict stats via worktreeManager.diffReport and never
  // runs a merge, writes no state, and appends no journal line — a read-only
  // query, so T-020's transition() rules do not apply. Non-worktree modes
  // return a not-applicable object (never throws for readonly).
  async function mergeCheck(id) {
    const state = readState(id);
    if (!state) throw new Error('mergeCheck: unknown id ' + id);
    if (state.mode !== 'worktree') {
      return { applicable: false, reason: 'merge not applicable: delegation ' + id + ' runs in mode ' + (state.mode || 'readonly') };
    }
    if (!state.worktree || !state.worktree.branch) {
      throw new Error('mergeCheck: delegation ' + id + ' has no worktree recorded');
    }
    if (!worktreeManager || typeof worktreeManager.diffReport !== 'function') {
      throw new Error('mergeCheck: worktreeManager.diffReport unavailable');
    }
    const repo = (state.worktree && state.worktree.repoDir) || repoDir;
    if (!repo) throw new Error('mergeCheck: repoDir unavailable for delegation ' + id);
    try {
      return await worktreeManager.diffReport(repo, state.worktree);
    } catch (err) {
      throw new Error('mergeCheck failed for ' + id + ': ' + (err && err.message ? err.message : String(err)));
    }
  }

  // Capability enforcement (T-011): abort a running delegation whose observed
  // usage exceeds its capability manifest. Observed tokens come from
  // spawner.getActivity(childSessionID).tokens (sum input+output if present);
  // observed tool calls come from client.session.get messages length when
  // available. Breach aborts via stopDelegation (signal hard, reason routed
  // through opts so the summary lands), then marks error: capability_breach.
  // Tighter bound wins when both are set; either source alone suffices.
  function minDefined(a, b) {
    if (a == null) return b == null ? null : b;
    if (b == null) return a;
    return Math.min(a, b);
  }
  async function enforceCapabilities(id) {
    const state = readState(id);
    if (!state) return null;
    // Effective cap merges the capability manifest with the flat budget
    // (bg_delegate `budget` arg, stored as state.budget): a budget-only caller
    // gets the same protection as a manifest caller.
    const cap = state.capabilities || {};
    const bud = state.budget || {};
    const maxTokens = minDefined(cap.maxTokens, bud.maxTokens);
    const maxToolCalls = minDefined(cap.maxToolCalls, bud.maxToolCalls);
    if (maxTokens == null && maxToolCalls == null) return null;
    if (!state.childSessionID) return null;
    let observedTokens = 0;
    let haveTokens = false;
    try {
      const activity = await spawner.getActivity(state.childSessionID);
      const tokens = activity && activity.tokens;
      if (typeof tokens === 'number') {
        observedTokens = tokens;
        haveTokens = true;
      } else if (tokens && typeof tokens === 'object') {
        if (typeof tokens.input === 'number' || typeof tokens.output === 'number') {
          observedTokens = (tokens.input || 0) + (tokens.output || 0);
          haveTokens = true;
        } else if (typeof tokens.inputTokens === 'number' || typeof tokens.outputTokens === 'number') {
          observedTokens = (tokens.inputTokens || 0) + (tokens.outputTokens || 0);
          haveTokens = true;
        } else if (typeof tokens.total === 'number') {
          observedTokens = tokens.total;
          haveTokens = true;
        } else if (typeof tokens.totalTokens === 'number') {
          observedTokens = tokens.totalTokens;
          haveTokens = true;
        }
      }
    } catch {
      return null;
    }
    let observedCalls = 0;
    let haveCalls = false;
    if (maxToolCalls != null) {
      try {
        if (client && client.session && typeof client.session.get === 'function') {
          const raw = unwrap(await client.session.get({ path: { id: state.childSessionID } }));
          const msgs = raw && raw.messages;
          if (Array.isArray(msgs)) {
            observedCalls = msgs.length;
            haveCalls = true;
          }
        }
      } catch {
        /* best-effort: tool-call count unavailable */
      }
      if (!haveCalls) {
        try {
          if (client && client.session && typeof client.session.messages === 'function') {
            const rawMsgs = unwrap(await client.session.messages({ path: { id: state.childSessionID } }));
            const arr = Array.isArray(rawMsgs) ? rawMsgs : (rawMsgs && Array.isArray(rawMsgs.messages) ? rawMsgs.messages : null);
            if (arr) {
              observedCalls = arr.length;
              haveCalls = true;
            }
          }
        } catch {
          /* best-effort: tool-call count unavailable */
        }
      }
    }
    if (maxTokens != null && haveTokens && observedTokens > maxTokens) {
      /* token breach: fall through to abort below */
    } else if (maxToolCalls != null && haveCalls && observedCalls > maxToolCalls) {
      /* tool-call breach: fall through to abort below */
    } else {
      return null;
    }
    await stopDelegation(id, { signal: 'hard', reason: 'capability_breach' });
    const breached = readState(id);
    if (!breached) return null;
    // Review M2: the child may have completed during the activity awaits above
    // (stopDelegation then returns it untouched) — only a freshly-cancelled
    // delegation becomes error: capability_breach. Never overwrite terminal.
    if (breached.state !== 'cancelled') return breached;
    breached.state = 'error';
    // Summary already 'capability_breach' via the reason param — keep it.
    transition(breached, 'error', { summary: breached.summary, childSessionID: breached.childSessionID });
    return breached;
  }

  // Self-healing retry-or-quarantine (T-023): called from reconcileOrphans for
  // a delegation observed in `error` at scan time. `cancelled` never reaches
  // here (reconcile skips it) and `interrupt` is terminal-by-supervisor, so
  // only `error` is retried. Quarantined tasks are never auto-retried — only
  // an explicit resume (T-031 bg_resume) clears quarantine.
  // - retryCount < retryBudget → bump retryCount, reset to `registered`,
  //   journal `retry` via transition(), then admit + start again (queued when
  //   the scheduler — including its spawn circuit breaker — refuses).
  // - retryCount >= retryBudget → set quarantined=true, journal `quarantined`.
  // Worktree reuse: mode 'worktree' keeps the EXISTING state.worktree.path
  // (no new worktree, no leak); worktreeManager.setup runs only when the path
  // is missing (guarded fs check, never throws). Every mutation persists via
  // transition(), so every journal payload passes through redactDeepFn.
  async function maybeRetryOrQuarantine(id) {
    const state = readState(id);
    if (!state || state.state !== 'error' || state.quarantined) return false;
    const observed = typeof state.retryCount === 'number' ? state.retryCount : 0;
    if (observed >= retryBudget) {
      state.quarantined = true;
      running.delete(state.id);
      removeFromQueue(state.id);
      transition(state, 'quarantined', { retryCount: observed, summary: state.summary });
      return true;
    }
    if (state.mode === 'worktree' && state.worktree && state.worktree.path) {
      let worktreePathExists = false;
      try {
        worktreePathExists = fs.existsSync(state.worktree.path);
      } catch {
        worktreePathExists = false;
      }
      if (!worktreePathExists && worktreeManager && typeof worktreeManager.setup === 'function' && repoDir) {
        try {
          const rebuilt = await worktreeManager.setup(repoDir, state.id);
          state.worktree = rebuilt;
          if (rebuilt && rebuilt.path) state.directory = rebuilt.path;
        } catch {
          /* setup failure surfaces as a start failure below — never throw here */
        }
      }
    }
    const previousChild = state.childSessionID || null;
    state.retryCount = observed + 1;
    state.state = 'registered';
    state.childSessionID = null;
    running.delete(state.id);
    transition(state, 'retry', { retryCount: state.retryCount, previousChildSessionID: previousChild, summary: state.summary });
    if (queue.find((q) => q.id === state.id)) return true;
    const admission = scheduler.acquire(admissionKey(state), state.parentID || null);
    if (!admission.ok) {
      queue.push({ id: state.id, priority: state.priority });
      queue.sort((a, b) => b.priority - a.priority);
      return true;
    }
    try {
      await startDelegation(state.id);
    } catch (err) {
      scheduler.release(admissionKey(state), state.parentID || null);
      const cur = readState(state.id);
      if (cur && cur.state !== 'completed' && cur.state !== 'cancelled' && cur.state !== 'interrupt' && cur.state !== 'error') {
        cur.state = 'error';
        cur.summary = 'retry_failed: ' + (err && err.message ? err.message : String(err));
        transition(cur, 'error', { summary: cur.summary });
      }
      running.delete(state.id);
    }
    return true;
  }

  // T-031 resume context: last journal summary for the [Resume context]
  // suffix — the newest completed/error event's summary, else the newest
  // summary/partial on any event. Total: journal.replay is [] when the file
  // is missing, and every failure here lands '' (resume then re-spawns with
  // the bare original prompt). Never throws.
  function lastResumeContext(id) {
    let events = [];
    try {
      events = journal.replay(id) || [];
    } catch {
      return '';
    }
    if (!Array.isArray(events) || events.length === 0) return '';
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev) continue;
      if ((ev.type === 'completed' || ev.type === 'error')
        && ev.payload && typeof ev.payload.summary === 'string' && ev.payload.summary) {
        return ev.payload.summary;
      }
    }
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const ev = events[i];
      if (!ev || !ev.payload) continue;
      if (typeof ev.payload.summary === 'string' && ev.payload.summary) return ev.payload.summary;
      if (typeof ev.payload.partial === 'string' && ev.payload.partial) return ev.payload.partial;
    }
    return '';
  }

  // T-031 explicit resume (Journey E: re-inject prior state + partial,
  // re-spawn from the last committed worktree state — never from scratch,
  // never merges). Requires mode 'worktree' with a recorded worktree path:
  // readonly delegations (and worktree delegations with no recorded path)
  // return { cannot_resume: '<reason>' } instead of throwing, so bg_resume
  // can report them as status strings. Quarantine clears ONLY here (T-023
  // never auto-retries quarantined tasks): quarantined=false, retryCount=0.
  // The SAME state.worktree.path is reused; worktreeManager.setup runs only
  // when the path is missing on disk (T-024 precedent, same guarded check as
  // maybeRetryOrQuarantine). The stored prompt stays the verbatim original —
  // the augmented text is passed as a spawn override only (see
  // startDelegation), so repeated resumes never stack context layers. The
  // reset persists via transition() ('resume' line, redacted by construction
  // — the full resume prompt is deliberately NOT journaled, only the
  // summary), then the delegation is admitted + started like a retry (queued
  // when the scheduler refuses). Returns the fresh state (running on the
  // free-slot path) or the cannot_resume object. Throws only for unknown id.
  async function resumeDelegation(id) {
    const state = readState(id);
    if (!state) throw new Error('resumeDelegation: unknown id ' + id);
    if (state.mode !== 'worktree') return { cannot_resume: 'no_worktree' };
    if (!state.worktree || !state.worktree.path) return { cannot_resume: 'no_worktree_path' };
    // Pre-T-031 state files have no prompt field: report cannot_resume rather
    // than spawning a child with no instruction.
    if (typeof state.prompt !== 'string' || !state.prompt) return { cannot_resume: 'no_prompt' };
    let worktreePathExists = false;
    try {
      worktreePathExists = fs.existsSync(state.worktree.path);
    } catch {
      worktreePathExists = false;
    }
    if (!worktreePathExists && worktreeManager && typeof worktreeManager.setup === 'function' && repoDir) {
      try {
        const rebuilt = await worktreeManager.setup(repoDir, state.id);
        state.worktree = rebuilt;
        if (rebuilt && rebuilt.path) state.directory = rebuilt.path;
      } catch {
        /* setup failure surfaces as a start failure below — never throw here */
      }
    }
    const resumeContext = lastResumeContext(id);
    const resumePrompt = resumeContext ? state.prompt + '\n\n[Resume context] ' + resumeContext : state.prompt;
    const previousChild = state.childSessionID || null;
    state.quarantined = false;
    state.retryCount = 0;
    state.state = 'registered';
    state.heartbeatAt = null;
    state.childSessionID = null;
    running.delete(state.id);
    removeFromQueue(state.id);
    transition(state, 'resume', { previousChildSessionID: previousChild, summary: state.summary });
    const admission = scheduler.acquire(admissionKey(state), state.parentID || null);
    if (!admission.ok) {
      queue.push({ id: state.id, priority: state.priority });
      queue.sort((a, b) => b.priority - a.priority);
      return readState(state.id);
    }
    try {
      await startDelegation(state.id, { prompt: resumePrompt, directory: state.worktree.path });
    } catch (err) {
      scheduler.release(admissionKey(state), state.parentID || null);
      running.delete(state.id);
      const cur = readState(state.id);
      if (cur && cur.state !== 'completed' && cur.state !== 'cancelled' && cur.state !== 'interrupt' && cur.state !== 'error') {
        cur.state = 'error';
        cur.summary = 'resume_failed: ' + (err && err.message ? err.message : String(err));
        transition(cur, 'error', { summary: cur.summary });
      }
      return readState(state.id);
    }
    return readState(state.id);
  }

  async function reconcileOrphans() {
    ensureStore();
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith('.json'));
    const orphans = [];
    // T-023: non-quarantined `error` states are orphans eligible for
    // retry-or-quarantine below. Quarantined errors wait for explicit resume
    // (T-031); completed/cancelled/interrupt stay terminal (interrupts are
    // terminal-by-supervisor and are never retried — only `error` is).
    const errorAtScan = new Set();
    for (const f of files) {
      const st = readState(f.replace('.json', ''));
      if (!st) continue;
      if (st.state === 'completed' || st.state === 'cancelled' || st.state === 'interrupt') continue;
      if (st.state === 'error') {
        if (st.quarantined) continue;
        errorAtScan.add(st.id);
      }
      orphans.push(st);
    }
    // T-021 resync: scheduler counters are in-memory and die with the process,
    // while the running set is rebuilt from disk — so after an unclean restart
    // (or a test harness clearing running) stale counts could pin the global
    // cap forever. Reset, then re-acquire one slot per live tracked id.
    // Re-acquire is best-effort: an already-live delegation keeps running even
    // if admission currently fails; releases on terminal paths heal any gap.
    scheduler.reset();
    for (const st of orphans) {
      // T-023: error states hold no live child, so no slot to resync — the
      // retry path acquires on demand. Resyncing one here would leak a slot.
      if (st.state === 'error') continue;
      if (running.has(st.id)) scheduler.acquire(admissionKey(st), st.parentID || null);
    }
    orphans.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const st of orphans) {
      if (processing.has(st.id)) continue;
      processing.add(st.id);
      try {
        // T-023: errors observed at scan time (previous passes) retry or
        // quarantine here. Errors minted mid-pass below (capability breach,
        // fresh terminal errors, start failures) wait for the next pass, so
        // each keeps its single-transition semantics per pass.
        if (errorAtScan.has(st.id)) {
          const preCheck = readState(st.id);
          if (preCheck && preCheck.state === 'error' && !preCheck.quarantined) {
            await maybeRetryOrQuarantine(st.id);
          }
          continue;
        }
        // Order: capability check -> terminal evaluation -> adopt/complete/start.
        // A breached-then-interrupted delegation finalizes exactly once: breach
        // sets error terminal, evaluateTerminal skips terminal states, and
        // finalizeDelegation protects terminal states.
        if (st.state === 'running') {
          await enforceCapabilities(st.id);
          const afterEnforce = readState(st.id);
          if (afterEnforce && afterEnforce.state === 'error' && afterEnforce.summary === 'capability_breach') continue;
        }
        const terminal = await evaluateTerminal(st.id);
        if (terminal) {
          // T-020: evaluateTerminal already journaled the interrupt/error via
          // transition() — journaling here again would double-count. Keep only
          // the onTerminal notify.
          if (onTerminal) onTerminal(terminal.id, terminal);
          continue;
        }
        const fresh = readState(st.id);
        if (!fresh) continue;
        if (fresh.state === 'completed' || fresh.state === 'error' || fresh.state === 'cancelled' || fresh.state === 'interrupt') continue;
        const complete = await childIsComplete(fresh.childSessionID);
        if (complete) {
          const result = await fetchChildResult(fresh.childSessionID);
          await finalizeDelegation(fresh.id, result || '(reconciled)');
        } else if (fresh.state === 'registered' && !running.has(fresh.id) && !queue.find((q) => q.id === fresh.id)) {
          const admission = scheduler.acquire(admissionKey(fresh), fresh.parentID || null);
          if (admission.ok) {
            try {
              await startDelegation(fresh.id);
            } catch {
              // m1: per-orphan failure — mark error and continue the pass
              // (mirrors dequeue). Rethrowing here would abort the whole
              // supervisor pass on one poisoned orphan.
              scheduler.release(admissionKey(fresh), fresh.parentID || null);
              const failed = readState(fresh.id);
              if (failed) {
                failed.state = 'error';
                failed.summary = 'failed to start';
                transition(failed, 'error', { summary: failed.summary, childSessionID: failed.childSessionID });
              }
              running.delete(fresh.id);
            }
          } else {
            queue.push({ id: fresh.id, priority: fresh.priority });
            queue.sort((a, b) => b.priority - a.priority);
          }
        }
      } finally {
        processing.delete(st.id);
      }
    }
  }

  // T-025 bg_prune extends to journals: terminal state is retained maxAgeDays
  // (default 30d) AND each terminal delegation's journal is pruned at
  // SWE_PRO_BG_JOURNAL_PRUNE_DAYS (default 7d), independently of state age.
  // Accepted tradeoff (user-flow): after 7 d the journal is gone but the
  // state remains the source of truth, so replay() is impossible for old
  // delegations — intended. Deletions write no journal line (T-020's
  // transition() rule does not apply): the journal file itself is being
  // removed, so there is nowhere to append — deletions are silent by design.
  async function pruneDelegations(maxAgeDays = 30) {
    ensureStore();
    const maxAgeMs = maxAgeDays * MS_PER_DAY;
    const journalMaxAgeMs = (parseInt(env.SWE_PRO_BG_JOURNAL_PRUNE_DAYS, 10) || DEFAULT_JOURNAL_PRUNE_DAYS) * MS_PER_DAY;
    const now = Date.now();
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith('.json'));
    let removed = 0;
    for (const f of files) {
      const st = readState(f.replace('.json', ''));
      if (!st) continue;
      if (st.state !== 'completed' && st.state !== 'error' && st.state !== 'cancelled' && st.state !== 'interrupt') continue;
      // Independent journal leg: a terminal delegation whose state is younger
      // than maxAgeDays but whose journal is older than journalMaxAgeMs still
      // loses its journal (e.g. 10d-old terminal keeps state, loses journal).
      try {
        journal.prune(st.id, journalMaxAgeMs, true);
      } catch {
        /* ignore individual failures */
      }
      const ts = st.updatedAt || st.createdAt || 0;
      if (now - ts > maxAgeMs) {
        try {
          fs.rmSync(markdownPath(st.id), { force: true });
          fs.rmSync(statePath(st.id), { force: true });
          // The journal leg above already removed old journals; drop any
          // fresh remnant so a deleted state never leaves an orphan journal.
          fs.rmSync(path.join(storeDir, st.id + '.journal.jsonl'), { force: true });
          removed += 1;
        } catch {
          /* ignore individual failures */
        }
      }
    }
    return removed;
  }

  return {
    createDelegation,
    finalizeDelegation,
    readDelegation,
    listDelegations,
    logPath,
    logEvent,
    stopDelegation,
    reconcileOrphans,
    spawnDelegation,
    pruneDelegations,
    mergeCheck,
    resumeDelegation,
    _internals: { running, queue, storeDir, maxParallel, scheduler, readState, writeState, startDelegation, dequeue, ensureStore },
  };
}
// </swe-pro-generated>

// ---------------------------------------------------------------------------
// Adapter helpers
// ---------------------------------------------------------------------------
function notifyParent(client, parentID, id, state) {
  if (!parentID || !client || !client.session) return;
  const text = `Background delegation ${id} is ${state.state}. ${state.summary || ''}`.trim();
  const body = { parts: [{ type: 'text', text }] };
  if (typeof client.session.message === 'function') {
    client.session.message({ path: { id: parentID }, body }).catch(() => {});
  } else if (typeof client.session.prompt === 'function') {
    client.session.prompt({ path: { id: parentID }, body: { parts: [{ type: 'text', text: '[notification] ' + text }] } }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Plugin server (merged: goal/continuation + background delegation)
// ---------------------------------------------------------------------------
module.exports = {
  id: 'swe-pro-agents',
  server: async (ctx) => {
    const { client, directory } = ctx;

    // Background delegation setup.
    const wm = createWorktreeManager();
    const bg = createBackgroundDelegate({
      client,
      directory,
      repoDir: directory,
      worktreeManager: wm,
      onTerminal: (id, state) => notifyParent(client, state.parentID, id, state),
    });
    bg.reconcileOrphans().catch(() => {});

    // Supervisor: periodically reconcile so completed children notify the parent
    // even if the parent never calls bg_read. Disable via SWE_PRO_BG_SUPERVISOR=0.
    if (process.env.SWE_PRO_BG_SUPERVISOR !== '0') {
      const ms = parseInt(process.env.SWE_PRO_BG_SUPERVISOR_MS, 10) || 5000;
      let reconciling = false;
      const timer = setInterval(() => {
        if (reconciling) return;
        reconciling = true;
        bg.reconcileOrphans().catch(() => {}).finally(() => {
          reconciling = false;
        });
      }, ms);
      if (timer.unref) timer.unref();
    }

    try {
      console.error('[swe-pro-agents] goal system: ' + (isGoalEnabled(directory) ? 'enabled' : 'disabled'));
    } catch {}

    const requireId = (args, name) => {
      if (!args || !args.id) throw new Error(name + ' requires an id');
      return args.id;
    };

    return {
      config: async (config) => {
        if (!isGoalEnabled(directory)) return;
        try {
          config.command = config.command || {};
          if (!config.command['goal']) {
            config.command['goal'] = {
              // NOTE: no `agent` pin on purpose. An agent-pinned command only
              // surfaces in that agent's sessions, which hid /goal from the
              // default Build session entirely. Goal handling is plain text
              // processing that works in any session; the autonomous loop
              // itself still runs in swe-pro sessions (see template below).
              template:
                'Handle the /goal slash command. User arguments: $ARGUMENTS\n\n' +
                'Parse arguments.trim().toLowerCase():\n' +
                '- "" or objective (including "resume" with or without objective) → Goal set: "<args>" — loop armed. Reply one line + help.\n' +
                '- "show" | "status" | "help" → report current goal (best-effort from history; if none, "No active goal remembered") + ledger summary if you can read plans/state.json (display only) + Usage: /goal [<objective>] | /goal show | /goal pause|resume | /goal clear (aliases: stop,off,reset,none,cancel). Standalone /pause_goal and /resume_goal do the same without arguments. These are READ-ONLY — they do NOT arm or disarm the loop.\n' +
                '- "pause" → Goal paused — loop disarmed. Use /goal resume or /resume_goal to continue.\n' +
                '- "clear" | "stop" | "off" | "reset" | "none" | "cancel" → Goal cleared — loop disarmed. Idempotent.\n' +
                'Never modify plans/state.json for goal — the continuation plugin owns armedSessions, the ledger owns tasks. Note: this invocation arms/disarms the gate via command.executed (show/status/help do not). Fail-closed: restart requires fresh /goal. Headless swe-pro-agents run needs no /goal.\n' +
                'Autonomous execution runs in swe-pro sessions: this command works everywhere, but the loop only continues on idle in a swe-pro session with pending plan work — switch to @swe-pro (or start one) for hands-free execution.',
              description: 'Set, show, pause, resume, or clear the active thread goal (show/status/help are read-only)',
            };
            // Standalone controls (same gate, no subcommand parsing): visible
            // in the palette and to integrations listing the command catalog.
            // Unpinned like /goal — see the NOTE above.
            if (!config.command['pause_goal']) {
              config.command['pause_goal'] = {
                template:
                  'Pause the autonomous loop for this session (same as /goal pause). ' +
                  'Reply one line confirming the loop is disarmed; /goal resume or /resume_goal re-arms it.',
                description: 'Pause the autonomous loop for this session',
              };
            }
            if (!config.command['resume_goal']) {
              config.command['resume_goal'] = {
                template:
                  'Re-arm the autonomous loop for this session (same as /goal resume). ' +
                  'Reply one line confirming; the loop continues on idle in a swe-pro session with pending plan work.',
                description: 'Re-arm the autonomous loop for this session',
              };
            }
          }
        } catch {}
      },

      event: async ({ event }) => {
        try {
          if (!event || !event.type) return;
          if (!isGoalEnabled(directory)) return;

          if (event.type === 'command.executed') {
            handleGoalEvent(event);
            return;
          }
          if (event.type !== 'session.idle') return;

          const sessionID = event.properties && event.properties.sessionID;
          if (!sessionID) return;

          const session = await client.session.get({ path: { id: sessionID } });
          const sessionAgent = session && session.agent;

          if (!shouldNudge({ directory, sessionID, sessionAgent })) return;

          await client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: 'swe-pro',
              parts: [{ type: 'text', text: NUDGE_MESSAGE }],
            },
          });
        } catch {
          // The hook never throws — a failure here must not crash the session.
        }
      },

      tool: {
        bg_delegate: {
          description:
            'Launch a background subagent (fire-and-forget). Returns a stable delegation ID immediately; the child runs in the background. Read its result later with bg_read. Flags: mode readonly|worktree (default readonly — pass worktree explicitly for code tasks needing git-worktree isolation), capabilities {maxTokens,maxToolCalls} to cap the child (breach aborts it), budget {maxTokens,maxToolCalls} as an alias cap, priority hint (higher starts first; model/provider also raise priority), depth (default 1; nesting past maxDepth is rejected). NEVER auto-merges: worktree results are reported via bg_merge --check only; merging stays an explicit human step.',
          args: {
            prompt: { type: 'string', required: true, description: 'Instruction for the background subagent.' },
            agent: { type: 'string', required: false, description: 'Agent to use (best-effort; child may inherit the parent agent).' },
            mode: { type: 'string', required: false, description: 'readonly (default) | worktree — pass worktree explicitly for code tasks needing git-worktree isolation.' },
            model: { type: 'string', required: false, description: 'Model override (raises scheduling priority).' },
            title: { type: 'string', required: false, description: 'Human-readable title.' },
            capabilities: { type: 'object', required: false, description: 'Capability manifest {maxTokens,maxToolCalls} — exceeding it aborts the child (capability_breach).' },
            budget: { type: 'object', required: false, description: 'Budget cap {maxTokens,maxToolCalls}, forwarded as the delegation cap.' },
            priority: { type: 'number', required: false, description: 'Scheduling priority hint — informational only: the engine orders by model>provider>default and ignores this value.' },
            depth: { type: 'number', required: false, description: 'Delegation depth — informational only: the engine derives depth from the parent chain (root = 1) and ignores this value.' },
          },
          async execute(args, toolCtx) {
            if (!args || !args.prompt) return 'bg_delegate error: prompt is required';
            const parentID = (toolCtx && toolCtx.sessionID) || (ctx.session && ctx.session.id) || null;
            const budget = args.budget && typeof args.budget === 'object' ? args.budget : null;
            const id = await bg.createDelegation({
              prompt: args.prompt,
              agent: args.agent,
              mode: args.mode,
              model: args.model,
              title: args.title,
              capabilities: args.capabilities && typeof args.capabilities === 'object' ? args.capabilities : undefined,
              maxTokens: budget && budget.maxTokens != null ? budget.maxTokens : undefined,
              maxToolCalls: budget && budget.maxToolCalls != null ? budget.maxToolCalls : undefined,
              parentID,
              directory,
            });
            return `delegated ${id} (background). Read with bg_read.`;
          },
        },

        bg_status: {
          description: 'Poll one or all delegations: registered/running/completed/error/cancelled + summary. Pass json:true for machine-readable detail including the per-task logPath (tail <id>.log for the full event log).',
          args: {
            id: { type: 'string', required: false, description: 'Delegation ID, or omit for all.' },
            json: { type: 'boolean', required: false, description: 'When true, return toJson detail with logPath per item.' },
          },
          async execute(args) {
            const list = await bg.listDelegations();
            const asJson = !!(args && args.json);
            const dashboardItems = (items) => {
              if (typeof toJson === 'function') return toJson(items, bg._internals.storeDir);
              return items.map((item) => Object.assign({}, item, { logPath: String(item.id) + '.log' }));
            };
            if (args && args.id) {
              const found = list.find((l) => l.id === args.id);
              if (!found) return `no delegation ${args.id}`;
              if (asJson) return JSON.stringify(dashboardItems([found])[0], null, 2);
              return JSON.stringify(found);
            }
            if (asJson) return JSON.stringify(dashboardItems(list), null, 2);
            return JSON.stringify(list, null, 2);
          },
        },

        bg_read: {
          description:
            'Block until a delegation is terminal or timeout, then return its persisted result. Default timeout 15 min. Never hangs beyond timeoutMs. Pass stream:true to also stream partial results to the per-task log while waiting.',
          args: {
            id: { type: 'string', required: true, description: 'Delegation ID.' },
            timeoutMs: { type: 'number', required: false, description: 'Max wait in ms (default 900000).' },
            stream: { type: 'boolean', required: false, description: 'When true, stream partial results to the per-task log while waiting (best-effort).' },
          },
          async execute(args) {
            const id = requireId(args, 'bg_read');
            const timeout = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined;
            // T-032 landed: the per-task log facility (bg.logEvent, appending to
            // <storeDir>/<id>.log) exists, so stream:true writes partials there
            // while the read still returns the final result normally. Best-effort:
            // a failing log append never breaks the read.
            const wantStream = !!(args && args.stream);
            if (wantStream && bg && typeof bg.logEvent === 'function') {
              return await bg.readDelegation(id, timeout, (partial) => {
                try {
                  bg.logEvent(id, partial);
                } catch {
                  /* per-task log is best-effort; never break the read */
                }
              });
            }
            return await bg.readDelegation(id, timeout);
          },
        },

        bg_list: {
          description: 'List all delegations with auto title + summary for scanability. Each item carries branch (worktree branch or null), tokens (last known value or null — no polling), createdAt, and updatedAt.',
          args: {},
          async execute() {
            return JSON.stringify(await bg.listDelegations(), null, 2);
          },
        },

        bg_stop: {
          description:
            'Abort/cancel a running delegation (supervisor control). Cascades to children. Flags: signal hard|soft (soft steers [stop after current step] before abort, hard aborts immediately), keep preserves the worktree. For worktree mode also removes the worktree unless keep:true.',
          args: {
            id: { type: 'string', required: true, description: 'Delegation ID.' },
            signal: { type: 'string', required: false, description: "Abort signal: 'hard' (default) aborts immediately, 'soft' steers the child before abort." },
            keep: { type: 'boolean', required: false, description: 'When true, preserve the worktree on disk (default false).' },
          },
          async execute(args) {
            const id = requireId(args, 'bg_stop');
            const signal = args && args.signal === 'soft' ? 'soft' : 'hard';
            const keep = !!(args && args.keep);
            const st = await bg.stopDelegation(id, { signal, keep });
            return `stopped ${id} (${st.state})`;
          },
        },

        bg_steer: {
          description:
            "Best-effort: append an instruction to a running delegation. LIMITATION: on some OpenCode versions this interrupts/resets the child's current step rather than queuing — treat as a hint, not a guaranteed non-interrupting command.",
          args: {
            id: { type: 'string', required: true, description: 'Delegation ID.' },
            prompt: { type: 'string', required: true, description: 'Instruction to append.' },
          },
          async execute(args) {
            const id = requireId(args, 'bg_steer');
            if (!args.prompt) return 'bg_steer error: prompt is required';
            const st = bg._internals.readState(id);
            if (!st) return `no delegation ${id}`;
            if (!st.childSessionID) return `delegation ${id} has no running child`;
            if (client.session && client.session.prompt) {
              client.session.prompt({ path: { id: st.childSessionID }, body: { parts: [{ type: 'text', text: args.prompt }] } }).catch(() => {});
            }
            return `steered ${id} (best-effort)`;
          },
        },

        bg_prune: {
          description: 'Retention: remove old completed/error/cancelled delegations from disk. Default max age 30 days.',
          args: { maxAgeDays: { type: 'number', required: false, description: 'Max age in days (default 30).' } },
          async execute(args) {
            const max = typeof args && typeof args.maxAgeDays === 'number' ? args.maxAgeDays : 30;
            const removed = await bg.pruneDelegations(max);
            return `pruned ${removed} delegation(s) older than ${max} days`;
          },
        },

        bg_merge: {
          description:
            'Check-only merge report for a worktree delegation: returns filesChanged/insertions/deletions/conflictProbability as JSON. NEVER auto-merges — check-only; no merge is ever performed (Journey D no-auto-merge guarantee).',
          args: {
            id: { type: 'string', required: true, description: 'Delegation ID.' },
            check: { type: 'boolean', required: false, description: 'Must be true (default true). Only --check reports are supported; merges are never performed.' },
          },
          async execute(args) {
            const id = requireId(args, 'bg_merge');
            if (args && 'check' in args && args.check !== true) return 'bg_merge error: only check:true is supported (this tool never merges)';
            const report = await bg.mergeCheck(id);
            return JSON.stringify(report, null, 2);
          },
        },

        bg_resume: {
          description:
            'Resume a crashed/errored/quarantined worktree delegation from its existing worktree (Journey E: re-injects prior state + partial, re-spawns from the last committed worktree state — never from scratch, never merges). Clears quarantine. Returns the new running status, or cannot_resume: <reason> (e.g. no_worktree for readonly mode).',
          args: {
            id: { type: 'string', required: true, description: 'Delegation ID.' },
          },
          async execute(args) {
            const id = requireId(args, 'bg_resume');
            const resumed = await bg.resumeDelegation(id);
            if (resumed && typeof resumed.cannot_resume === 'string') return `cannot_resume: ${resumed.cannot_resume}`;
            const current = (resumed && resumed.state) ? resumed : bg._internals.readState(id);
            return `resumed ${id} (${current.state})`;
          },
        },

        bg_dashboard: {
          description:
            'Live tree of all background delegations (Persona 2 glance view): one line per delegation with id, state, agent, branch, tokens, and age. Prints `no active delegations` when the store is empty.',
          args: {},
          async execute() {
            const list = await bg.listDelegations();
            return renderTree(list);
          },
        },

        // Goal tools: programmatic access to the same per-session goal state
        // the /goal commands drive. Records are ephemeral — a restart wipes
        // them, same as arming. Reads tolerate absence (null / []); writes
        // throw on missing sessionID or empty objective. There is deliberately
        // no close-with-evidence tool: this loop has no close concept, only
        // pause, resume, and clear.
        get_goal: {
          description: 'Read a session goal record (objective, status, timestamps). Returns null when the session has none.',
          args: {
            sessionID: { type: 'string', required: false, description: 'Session ID (defaults to the calling session).' },
          },
          async execute(args, toolCtx) {
            const sid = (args && args.sessionID) || (toolCtx && toolCtx.sessionID) || null;
            return JSON.stringify(getGoal(sid));
          },
        },
        set_goal: {
          description: 'Arm a session with an explicit objective (creates or updates). The session counts as goal-armed for idle continuation.',
          args: {
            sessionID: { type: 'string', required: false, description: 'Session ID (defaults to the calling session).' },
            objective: { type: 'string', required: true, description: 'The concrete objective to pursue.' },
          },
          async execute(args, toolCtx) {
            const sid = (args && args.sessionID) || (toolCtx && toolCtx.sessionID) || null;
            if (!sid) throw new Error('set_goal requires a sessionID');
            return JSON.stringify(setGoal(sid, args.objective));
          },
        },
        list_all_goals: {
          description: 'List every known session goal in this process (oldest-touched first). Empty array when none exist.',
          args: {},
          async execute() {
            return JSON.stringify(listGoals());
          },
        },
        get_goal_history: {
          description: 'Transition history for a session goal (bounded audit, newest last). Empty array when unknown.',
          args: {
            sessionID: { type: 'string', required: false, description: 'Session ID (defaults to the calling session).' },
          },
          async execute(args, toolCtx) {
            const sid = (args && args.sessionID) || (toolCtx && toolCtx.sessionID) || null;
            return JSON.stringify(getGoalHistory(sid));
          },
        },
        update_goal_objective: {
          description: 'Replace the objective of an existing session goal (unknown session throws; use set_goal to create).',
          args: {
            sessionID: { type: 'string', required: false, description: 'Session ID (defaults to the calling session).' },
            objective: { type: 'string', required: true, description: 'The updated concrete objective.' },
          },
          async execute(args, toolCtx) {
            const sid = (args && args.sessionID) || (toolCtx && toolCtx.sessionID) || null;
            if (!sid) throw new Error('update_goal_objective requires a sessionID');
            return JSON.stringify(updateGoalObjective(sid, args.objective));
          },
        },
        update_goal_status: {
          description: 'Flip a goal between active and paused. Activating an unknown session creates it (mirrors /resume_goal); pausing an unknown session returns null.',
          args: {
            sessionID: { type: 'string', required: false, description: 'Session ID (defaults to the calling session).' },
            status: { type: 'string', required: true, description: 'active or paused.' },
          },
          async execute(args, toolCtx) {
            const sid = (args && args.sessionID) || (toolCtx && toolCtx.sessionID) || null;
            if (!sid) throw new Error('update_goal_status requires a sessionID');
            return JSON.stringify(updateGoalStatus(sid, args.status));
          },
        },
        clear_goal: {
          description: 'Forget a session goal entirely. Returns whether one existed.',
          args: {
            sessionID: { type: 'string', required: false, description: 'Session ID (defaults to the calling session).' },
          },
          async execute(args, toolCtx) {
            const sid = (args && args.sessionID) || (toolCtx && toolCtx.sessionID) || null;
            if (!sid) throw new Error('clear_goal requires a sessionID');
            return JSON.stringify({ cleared: clearGoal(sid) });
          },
        },
      },
    };
  },

  // Exports for tests / introspection (not part of the OpenCode plugin seam).
  createBackgroundDelegate,
  createWorktreeManager,
  resolveStoreDir,
  unwrap,
  DEFAULT_MAX_PARALLEL,
  DEFAULT_READ_TIMEOUT_MS,
  LOOP_AGENT,
  DISARM_SUBCOMMANDS,
  GOAL_COMMANDS,
  NUDGE_MESSAGE,
  handleGoalEvent,
  isArmed,
  shouldNudge,
  explain,
  reset: resetGate,
  setGoal,
  getGoal,
  listGoals,
  getGoalHistory,
  updateGoalObjective,
  updateGoalStatus,
  clearGoal,
  _readState: gateReadState,
  _shouldResume: ledgerResumable,
  _stateFile: gateStateFile,
};
