/**
 * Logic core for the plan-execution loop.
 *
 * Zero dependencies: the pure functions operate over the ledger state shape
 * below (no fs, no process, no network). The only I/O in this module is
 * confined to loadState/saveState/initLedger, which read and write the ledger
 * file. Both the interactive conductor and the CLI drive this module.
 *
 * Ledger state (schema v1):
 *   {
 *     version: 1,
 *     status: 'running' | 'paused' | 'blocked' | 'done' | 'aborted',
 *     plan: 'plans/tasks.md',
 *     iterations: <number of attempt results recorded>,
 *     tasks: [{ id, phase, title, status, attempts, last_verify }],
 *     budget: { max_attempts_per_task, max_iterations_per_run, started_at }
 *   }
 */

const fs = require('fs');

/** Schema version of the ledger state. Bump on any breaking shape change. */
const LEDGER_SCHEMA_VERSION = 1;

/** Valid ledger-level statuses. */
const LEDGER_STATUSES = new Set(['running', 'paused', 'blocked', 'done', 'aborted']);

/** Valid per-task statuses. */
const TASK_STATUSES = new Set(['pending', 'in_progress', 'done', 'blocked']);

/** Default plan file the ledger tracks. */
const DEFAULT_PLAN = 'plans/tasks.md';

/** Default attempt budget per task. */
const DEFAULT_MAX_ATTEMPTS_PER_TASK = 2;

/** Default iteration budget per run. */
const DEFAULT_MAX_ITERATIONS_PER_RUN = 40;

/**
 * The task-heading grammar: `### T-###` with optional trailing title text
 * (separator punctuation like "—", "-", or ":" is stripped by the caller).
 * Shared with scripts/validate-plan.js so the plan validator recognizes
 * exactly the headings the loop parses.
 */
const TASK_HEADING_RE = /^###\s+(T-\d+)\s*(.*)$/;

/**
 * Parse a plans/tasks.md-style document into task descriptors.
 *
 * Matches `### T-###` headings; the title is the heading text after the id
 * (leading separator punctuation like "—" is stripped). An optional
 * `**Phase.**` line directly under the heading is read if present, else the
 * phase is ''. Returns [] when no headings match.
 *
 * @param {string} markdown
 * @returns {Array<{id: string, phase: string, title: string}>}
 */
function tasksFromMarkdown(markdown) {
  const tasks = [];
  const lines = String(markdown).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_HEADING_RE);
    if (!m) continue;
    const id = m[1];
    const title = m[2].replace(/^[\s—–\-:]+/, '');
    let phase = '';
    // The phase line, if any, is the first non-blank line under the heading.
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j].trim();
      if (line === '') continue;
      const pm = line.match(/^\*\*Phase\.\*\*\s*(.*)$/);
      if (pm) phase = pm[1].trim();
      break;
    }
    tasks.push({ id, phase, title });
  }
  return tasks;
}

/**
 * Build a fresh schema-v1 ledger from parsed task descriptors.
 *
 * @param {Array<{id: string, phase: string, title: string}>} tasks
 * @returns {object} schema-v1 state
 */
function initState(tasks) {
  return {
    version: LEDGER_SCHEMA_VERSION,
    status: 'running',
    plan: DEFAULT_PLAN,
    iterations: 0,
    tasks: (tasks || []).map((t) => ({
      id: t.id,
      phase: t.phase || '',
      title: t.title || '',
      status: 'pending',
      attempts: 0,
      last_verify: null,
    })),
    budget: {
      max_attempts_per_task: DEFAULT_MAX_ATTEMPTS_PER_TASK,
      max_iterations_per_run: DEFAULT_MAX_ITERATIONS_PER_RUN,
      started_at: new Date().toISOString(),
    },
  };
}

/**
 * Validate a ledger state. Returns { ok, errors }.
 *
 * Rejects: wrong schema version, unknown ledger status, missing/empty tasks,
 * unknown task status, duplicate task ids, over-budget attempts on non-blocked
 * tasks, a missing or malformed budget, and missing or negative iterations.
 *
 * @param {object} state
 * @returns {{ok: boolean, errors: string[]}}
 */
function validateState(state) {
  const errors = [];

  if (!state || typeof state !== 'object') {
    return { ok: false, errors: ['state is not an object'] };
  }

  if (state.version !== LEDGER_SCHEMA_VERSION) {
    errors.push(`version ${state.version} !== ${LEDGER_SCHEMA_VERSION}`);
  }

  if (!LEDGER_STATUSES.has(state.status)) {
    errors.push(`invalid status '${state.status}'`);
  }

  if (!Array.isArray(state.tasks) || state.tasks.length === 0) {
    errors.push('tasks must be a non-empty array');
  } else {
    const seen = new Set();
    for (const task of state.tasks) {
      if (!task || typeof task !== 'object') {
        errors.push('task records must be objects');
        continue;
      }
      if (typeof task.id !== 'string' || task.id.length === 0) {
        errors.push(`task has invalid id '${task.id}'`);
        continue;
      }
      if (!TASK_STATUSES.has(task.status)) {
        errors.push(`task '${task.id}' has invalid status '${task.status}'`);
      }
      if (seen.has(task.id)) {
        errors.push(`duplicate task id '${task.id}'`);
      }
      seen.add(task.id);
      if (typeof task.attempts !== 'number' || !Number.isInteger(task.attempts) || task.attempts < 0) {
        errors.push(`task '${task.id}' has invalid attempts '${task.attempts}'`);
      }
    }
    const maxAttempts = state.budget && state.budget.max_attempts_per_task;
    if (typeof maxAttempts === 'number') {
      for (const task of state.tasks) {
        if (task && typeof task === 'object' && task.status !== 'blocked' && task.attempts > maxAttempts) {
          errors.push(`task '${task.id}' has ${task.attempts} attempts (> ${maxAttempts})`);
        }
      }
    }
  }

  if (!state.budget || typeof state.budget !== 'object') {
    errors.push('budget must be an object');
  } else {
    if (
      typeof state.budget.max_attempts_per_task !== 'number' ||
      !Number.isInteger(state.budget.max_attempts_per_task) ||
      state.budget.max_attempts_per_task < 0
    ) {
      errors.push('budget.max_attempts_per_task must be a non-negative integer');
    }
    if (
      typeof state.budget.max_iterations_per_run !== 'number' ||
      !Number.isInteger(state.budget.max_iterations_per_run) ||
      state.budget.max_iterations_per_run < 0
    ) {
      errors.push('budget.max_iterations_per_run must be a non-negative integer');
    }
  }

  if (typeof state.iterations !== 'number' || !Number.isInteger(state.iterations)) {
    errors.push('iterations must be a non-negative integer');
  } else if (state.iterations < 0) {
    errors.push(`iterations ${state.iterations} < 0`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Pick the next task to run: the first pending task in plan order, else the
 * first in_progress task (resume), else null.
 *
 * @param {object} state
 * @returns {object|null}
 */
function nextTask(state) {
  for (const task of state.tasks) {
    if (task.status === 'pending') return task;
  }
  for (const task of state.tasks) {
    if (task.status === 'in_progress') return task;
  }
  return null;
}

/**
 * Whether the loop should keep going. False when the ledger is not running,
 * the iteration budget is exhausted, any task is blocked (stop-on-blocked), or
 * there is no next task.
 *
 * @param {object} state
 * @returns {boolean}
 */
function shouldContinue(state) {
  if (state.status !== 'running') return false;
  if (state.iterations >= state.budget.max_iterations_per_run) return false;
  if (state.tasks.some((t) => t.status === 'blocked')) return false;
  if (nextTask(state) === null) return false;
  return true;
}

/**
 * Mark a task in_progress. Pure: returns a new state. Idempotent when the task
 * is already in_progress. Throws on unknown ids and on done/blocked tasks.
 *
 * @param {object} state
 * @param {string} taskId
 * @returns {object} new state
 */
function markInProgress(state, taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`unknown task id '${taskId}'`);
  if (task.status === 'done' || task.status === 'blocked') {
    throw new Error(`cannot mark '${taskId}' in_progress: status is '${task.status}'`);
  }
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === taskId ? { ...t, status: 'in_progress' } : t)),
  };
}

/**
 * Reconcile the ledger against the current spec tasks. Tasks in the spec that
 * are missing from the ledger are appended as pending; ledger tasks missing
 * from the spec are dropped; matching ids keep their status/attempts/last_verify.
 * Ledger status and iterations are preserved.
 *
 * @param {object} state
 * @param {Array<{id: string, phase: string, title: string}>} tasks spec tasks
 * @returns {{state: object, added: string[], removed: string[]}}
 */
function syncWithSpec(state, tasks) {
  const specIds = new Set(tasks.map((t) => t.id));
  const ledgerById = new Map(state.tasks.map((t) => [t.id, t]));
  const added = [];
  const removed = [];

  const merged = [];
  for (const specTask of tasks) {
    const existing = ledgerById.get(specTask.id);
    if (existing) {
      // Refresh the descriptive fields from the spec; keep the execution
      // fields (status, attempts, last_verify) so progress is preserved.
      merged.push({ ...existing, phase: specTask.phase || '', title: specTask.title || '' });
    } else {
      merged.push({
        id: specTask.id,
        phase: specTask.phase || '',
        title: specTask.title || '',
        status: 'pending',
        attempts: 0,
        last_verify: null,
      });
      added.push(specTask.id);
    }
  }
  for (const task of state.tasks) {
    if (!specIds.has(task.id)) removed.push(task.id);
  }

  return { state: { ...state, tasks: merged }, added, removed };
}

/**
 * Record an attempt result for a task. Pure: returns a new state.
 *
 * 'done' → task done, last_verify set, iterations + 1.
 * 'fail' → attempts + 1, iterations + 1; at max attempts the task (and the
 *          ledger) become blocked (stop-on-blocked).
 * When every task is done the ledger status becomes 'done'.
 *
 * @param {object} state
 * @param {string} taskId
 * @param {'done'|'fail'} result
 * @returns {object} new state
 */
function applyAttemptResult(state, taskId, result) {
  if (result !== 'done' && result !== 'fail') {
    throw new Error(`unknown result '${result}'`);
  }
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`unknown task id '${taskId}'`);

  const maxAttempts = state.budget.max_attempts_per_task;
  let nextTaskState;
  if (result === 'done') {
    nextTaskState = { ...task, status: 'done', last_verify: new Date().toISOString() };
  } else {
    const attempts = task.attempts + 1;
    nextTaskState = {
      ...task,
      attempts,
      // Below max the task goes back to pending so the runner explicitly
      // re-dispatches the retry; at max it blocks (stop-on-blocked).
      status: attempts >= maxAttempts ? 'blocked' : 'pending',
    };
  }

  const tasks = state.tasks.map((t) => (t.id === taskId ? nextTaskState : t));
  let status = state.status;
  if (result === 'fail' && nextTaskState.status === 'blocked') {
    status = 'blocked';
  } else if (tasks.every((t) => t.status === 'done')) {
    status = 'done';
  }

  return { ...state, status, iterations: state.iterations + 1, tasks };
}

/**
 * The "CLI-driven run" directive sentence appended to cliMode continuation
 * messages (with surrounding spaces). Exported so bin/swe-pro-agents.js can
 * strip it for --no-continue without duplicating the literal.
 */
const CLI_DIRECTIVE = ' CLI-driven run: do NOT modify plans/state.json — the caller records results. ';

/**
 * Build the continuation prompt for the next task. Throws when there is no
 * next task. In cliMode the ledger instructions are replaced (the CLI is the
 * single writer of plans/state.json), not appended.
 *
 * @param {object} state
 * @param {{cliMode?: boolean}} [opts]
 * @returns {string}
 */
function buildContinuationMessage(state, opts) {
  const task = nextTask(state);
  if (!task) throw new Error('no next task');
  const cliMode = !!(opts && opts.cliMode);
  const head = `Continue plan execution. Next task: ${task.id} (Phase: ${task.phase}) — ${task.title}.`;
  if (cliMode) {
    return (
      head +
      CLI_DIRECTIVE +
      'Dispatch the task, verify the result, and end your reply with <promise>DONE</promise>. ' +
      'Never push or merge; destructive operations require explicit confirmation and are auto-denied here.'
    );
  }
  return (
    head +
    ' Load plans/state.json, validate it, mark the task in_progress, dispatch it, ' +
    'verify the result, record it, and end your reply with <promise>DONE</promise>.'
  );
}

/**
 * One-line ledger summary: `<status> | done X/Y | next T-###`, with optional
 * `| blocked T-###` and `| attempts <n>` (n = iterations, only when > 0)
 * segments appended in that order.
 *
 * @param {object} state
 * @returns {string}
 */
function summary(state) {
  const doneCount = state.tasks.filter((t) => t.status === 'done').length;
  const total = state.tasks.length;
  const parts = [`${state.status} | done ${doneCount}/${total}`];

  const next = nextTask(state);
  if (next) parts.push(`next ${next.id}`);

  const blocked = state.tasks.find((t) => t.status === 'blocked');
  if (blocked) parts.push(`blocked ${blocked.id}`);

  if (state.iterations > 0) parts.push(`attempts ${state.iterations}`);

  return parts.join(' | ');
}

/**
 * Load a ledger state from disk. Returns null (never throws) when the file is
 * missing, unreadable, contains invalid JSON, or fails validation.
 *
 * @param {string} path
 * @returns {object|null}
 */
function loadState(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, 'utf8');
  } catch (err) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return null;
  }
  const result = validateState(parsed);
  if (!result.ok) return null;
  return parsed;
}

/**
 * Persist a ledger state to disk. Validates first (throws on invalid state),
 * then writes to `<path>.tmp` and renames it over `<path>` — atomic on the
 * same filesystem, Windows included. No `.tmp` file is left behind on success.
 *
 * @param {string} path
 * @param {object} state
 * @returns {void}
 */
function saveState(path, state) {
  const result = validateState(state);
  if (!result.ok) {
    throw new Error(`refusing to save invalid state: ${result.errors.join('; ')}`);
  }
  const tmpPath = `${path}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, path);
}

/**
 * Create a fresh ledger on disk from a markdown plan and return the new state.
 *
 * @param {string} path
 * @param {string} markdown
 * @returns {object} the new schema-v1 state
 */
function initLedger(path, markdown) {
  const state = initState(tasksFromMarkdown(markdown));
  saveState(path, state);
  return state;
}

module.exports = {
  LEDGER_SCHEMA_VERSION,
  TASK_HEADING_RE,
  CLI_DIRECTIVE,
  tasksFromMarkdown,
  initState,
  validateState,
  nextTask,
  shouldContinue,
  markInProgress,
  syncWithSpec,
  applyAttemptResult,
  buildContinuationMessage,
  summary,
  loadState,
  saveState,
  initLedger,
};