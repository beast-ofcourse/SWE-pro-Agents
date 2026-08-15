#!/usr/bin/env node

/**
 * run-loop.js — multi-iteration plan-execution loop runner.
 *
 * Drives the loop-logic exports (scripts/loop-logic.js) until shouldContinue()
 * returns false. The CLI (bin/swe-pro-agents.js) and the OpenCode plugin both
 * drive this runner; it is the multi-iteration counterpart to the CLI's
 * single-iteration `run` command.
 *
 * Loop per iteration:
 *   shouldContinue → nextTask → markInProgress (atomic save) → print dispatch
 *   instructions (task id, phase, title, cliMode continuation message) → wait
 *   for the caller to record the result on stdin → applyAttemptResult (atomic
 *   save) → repeat until shouldContinue() is false.
 *
 * Results are read from stdin, one per line ('done' or 'fail'), one per
 * dispatched task. When stdin is a terminal the runner dispatches one task and
 * exits 0 — re-invoke with the result piped in to continue the loop. An
 * interrupted run (a task left in_progress) records that task's result first.
 *
 * Exit codes: 0 success, 1 runtime error, 2 usage error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');

const {
  initLedger,
  loadState,
  saveState,
  nextTask,
  markInProgress,
  applyAttemptResult,
  buildContinuationMessage,
  summary,
  shouldContinue,
  syncWithSpec,
  validateState,
  tasksFromMarkdown,
} = require('./loop-logic.js');

const { DEFAULT_PLAN_DIR, LEDGER_FILE, PLAN_FILE, stopReason, emit } = require('./cli-shared.js');

const pkg = require(path.join(__dirname, '..', 'package.json'));

/**
 * Parse the command-line arguments. Returns { ok: true, args } or
 * { ok: false, error }.
 */
function parseArgs(argv) {
  const args = {
    plan: DEFAULT_PLAN_DIR,
    maxIterations: null,
    dryRun: false,
    json: false,
    help: false,
    version: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--plan') {
      const value = argv[++i];
      if (value === undefined) return { ok: false, error: '--plan requires a directory argument' };
      args.plan = value;
    } else if (arg === '--max-iterations') {
      const value = argv[++i];
      if (value === undefined || !/^\d+$/.test(value) || Number(value) < 1) {
        return { ok: false, error: '--max-iterations requires a positive integer' };
      }
      args.maxIterations = Number(value);
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      args.version = true;
    } else if (arg.startsWith('-')) {
      return { ok: false, error: `unknown flag '${arg}'` };
    } else {
      return { ok: false, error: `unexpected argument '${arg}'` };
    }
  }
  return { ok: true, args };
}

/**
 * Read one result line from the caller. Returns 'done'|'fail', or null on EOF
 * (or when stdin is a terminal — the caller re-invokes with the result piped
 * in). Blank lines are skipped; anything else is a runtime error.
 */
async function readResult(iterator) {
  if (iterator === null) return null;
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) return null;
    const result = String(value).trim();
    if (result === '') continue;
    if (result !== 'done' && result !== 'fail') {
      throw new Error(`invalid result '${result}' (expected 'done' or 'fail')`);
    }
    return result;
  }
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) {
    usageError(parsed.error);
    return 2;
  }
  const args = parsed.args;
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args.version) {
    console.log(pkg.version);
    return 0;
  }

  const planDir = path.resolve(args.plan);
  const ledgerPath = path.join(planDir, LEDGER_FILE);
  const planFile = path.join(planDir, PLAN_FILE);

  if (!fs.existsSync(planFile)) {
    throw new Error(`plan file not found: ${planFile}`);
  }
  const markdown = fs.readFileSync(planFile, 'utf8');
  const specTasks = tasksFromMarkdown(markdown);
  if (specTasks.length === 0) {
    throw new Error(`plan file contains no tasks: ${planFile}`);
  }

  // Load the ledger; init it from the plan when missing. An existing file
  // that cannot be loaded (corrupt, invalid) is never silently replaced —
  // that would lose recorded progress.
  let state = loadState(ledgerPath);
  if (!state) {
    if (fs.existsSync(ledgerPath)) {
      throw new Error(`ledger exists but could not be loaded: ${ledgerPath}`);
    }
    state = initLedger(ledgerPath, markdown);
    if (args.maxIterations !== null) {
      state = { ...state, budget: { ...state.budget, max_iterations_per_run: args.maxIterations } };
      saveState(ledgerPath, state);
    }
  } else if (args.maxIterations !== null) {
    // Override the budget for this run; persisted on the next save.
    state = { ...state, budget: { ...state.budget, max_iterations_per_run: args.maxIterations } };
  }

  const validation = validateState(state);
  if (!validation.ok) {
    throw new Error(`ledger failed validation: ${validation.errors.join('; ')}`);
  }

  if (args.dryRun) {
    emit(
      args.json,
      {
        command: 'dry-run',
        status: 'ok',
        summary: summary(state),
        ledger: ledgerPath,
        tasks: state.tasks.map((t) => ({ id: t.id, phase: t.phase, title: t.title })),
      },
      [`Dry run — ${summary(state)}`]
    );
    return 0;
  }

  // Reconcile the ledger against the current plan spec before dispatching.
  const synced = syncWithSpec(state, specTasks);
  if (synced.added.length > 0 || synced.removed.length > 0) {
    state = synced.state;
    saveState(ledgerPath, state);
  }

  // The caller records results on stdin, one line per dispatched task. A
  // terminal stdin means the caller re-invokes with the result piped in, so
  // the runner dispatches one task and exits.
  const rl = process.stdin.isTTY
    ? null
    : readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const iterator = rl ? rl[Symbol.asyncIterator]() : null;

  while (shouldContinue(state)) {
    // Resume: an interrupted run leaves a task in_progress — record its
    // result before dispatching anything new.
    const inProgress = state.tasks.find((t) => t.status === 'in_progress');
    if (inProgress) {
      const result = await readResult(iterator);
      if (result === null) break;
      state = applyAttemptResult(state, inProgress.id, result);
      saveState(ledgerPath, state);
      continue;
    }

    const task = nextTask(state);
    // Build the message from the pre-dispatch state: buildContinuationMessage
    // resolves the task via nextTask(), which skips in_progress tasks, so the
    // message must be built before markInProgress to name the task being
    // dispatched.
    const message = buildContinuationMessage(state, { cliMode: true });
    state = markInProgress(state, task.id);
    saveState(ledgerPath, state);

    emit(
      args.json,
      {
        command: 'run',
        status: 'dispatched',
        task: { id: task.id, phase: task.phase, title: task.title },
        message,
        summary: summary(state),
      },
      [message]
    );

    const result = await readResult(iterator);
    if (result === null) break;
    state = applyAttemptResult(state, task.id, result);
    saveState(ledgerPath, state);
  }

  if (rl) rl.close();

  // The loop genuinely ended (shouldContinue false) — emit the final summary.
  // Breaking on EOF/terminal is not an end: the caller re-invokes to continue.
  if (!shouldContinue(state)) {
    emit(
      args.json,
      {
        command: 'run',
        status: 'stopped',
        summary: summary(state),
        reason: stopReason(state),
      },
      [summary(state)]
    );
  }
  return 0;
}

const USAGE = `Usage: node scripts/run-loop.js [options]

Multi-iteration plan-execution loop runner. Drives the loop-logic exports
(scripts/loop-logic.js) until shouldContinue() is false.

Options:
  --plan <dir>         Plan directory (default: plans)
  --max-iterations <n> Override the iterations budget (default: 40)
  --dry-run            Init the ledger from the plan without dispatching;
                       print the summary and exit 0
  --json               Machine-readable output (JSON on stdout, human text
                       on stderr)
  -h, --help           Show this help
  -v, --version        Show package version

Results are read from stdin, one per line ('done' or 'fail'), one per
dispatched task. When stdin is a terminal, the runner dispatches one task
and exits 0 — re-invoke with the result piped in to continue the loop.

Exit codes: 0 success, 1 runtime error, 2 usage error.
`;

function usageError(message) {
  if (message) process.stderr.write(`Error: ${message}\n`);
  process.stderr.write(USAGE);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`[run-loop] Error: ${err.message}`);
    process.exitCode = 1;
  });