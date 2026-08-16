#!/usr/bin/env node

/**
 * CLI for SWE Pro Agents.
 *
 * Commands:
 *   swe-pro-agents run [result] [--plan <dir>] [--dry-run]
 *                      [--max-iterations <n>] [--no-continue] [--json]
 *       — Drive the plan-execution loop (see cmdRun below).
 *   swe-pro-agents setup [--apply]   — Show the opencode.json config snippet
 *                                      (--apply writes it, with a .bak backup)
 *   swe-pro-agents status            — Show installation status + update check
 *   swe-pro-agents version           — Show version
 *   swe-pro-agents help              — Show this help
 *
 * Exit codes: 0 success, 1 runtime error, 2 usage error.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const {
  initState,
  tasksFromMarkdown,
  loadState,
  saveState,
  nextTask,
  markInProgress,
  applyAttemptResult,
  buildContinuationMessage,
  summary,
  shouldContinue,
  syncWithSpec,
  CLI_DIRECTIVE,
} = require('../scripts/loop-logic.js');

const { DEFAULT_PLAN_DIR, LEDGER_FILE, PLAN_FILE, stopReason, emit } = require('../scripts/cli-shared.js');

const PACKAGE_NAME = 'swe-pro-agents';
const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const TARGET_AGENTS_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);
const TARGET_SKILLS_DIR = path.join(os.homedir(), '.config', 'opencode', 'skills');
const PACK_AGENTS_MD = path.join(os.homedir(), '.config', 'swe-pro-agents', 'AGENTS.md');
const GLOBAL_AGENTS_MD = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
const OPENCODE_CONFIG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

const pkg = require(path.join(__dirname, '..', 'package.json'));

/** The agent path written into opencode.json (forward slashes — valid JSON on every OS). */
function configEntryPath() {
  return TARGET_AGENTS_DIR.replace(/\\/g, '/');
}

function getAgentCount() {
  if (!fs.existsSync(AGENTS_DIR)) return 0;
  return fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).length;
}

function getSkillCount() {
  if (!fs.existsSync(SKILLS_DIR)) return 0;
  return fs.readdirSync(SKILLS_DIR).filter(e =>
    fs.statSync(path.join(SKILLS_DIR, e)).isDirectory()
      && fs.existsSync(path.join(SKILLS_DIR, e, 'SKILL.md'))
  ).length;
}

function getInstalledAgentCount() {
  if (!fs.existsSync(TARGET_AGENTS_DIR)) return 0;
  // AGENTS.md lives in the pack's config dir, not here (see installAgentsMd in
  // install.js) — but a legacy copy from <= 2.5.x may linger; it's shared
  // foundation, not an agent, so exclude it.
  return fs.readdirSync(TARGET_AGENTS_DIR).filter(f => f.endsWith('.md') && f !== 'AGENTS.md').length;
}

function semverGt(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * Checks the npm registry for a newer version. Never throws and never blocks
 * status output for long — offline or slow registries just skip the check.
 * Fetches the registry directly (no child process) so it's also immune to
 * npm's local packument cache.
 */
function checkForUpdates() {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        clearTimeout(timer);
        const latest = data && data.version;
        if (!latest || !semverGt(latest, pkg.version)) return resolve(null);
        resolve(latest);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

function applyToOpenCodeConfig() {
  let config = {};
  let existed = false;

  if (fs.existsSync(OPENCODE_CONFIG)) {
    existed = true;
    try {
      const raw = fs.readFileSync(OPENCODE_CONFIG, 'utf-8').replace(/^\uFEFF/, '');
      config = JSON.parse(raw);
    } catch (err) {
      console.log(`  ERROR: could not parse ${OPENCODE_CONFIG}: ${err.message}`);
      console.log(`  Nothing was changed. Add the entry manually:`);
      console.log(`    { "agents": [{ "path": "${configEntryPath()}" }] }`);
      return;
    }
  }

  if (!config.agents) config.agents = [];
  if (config.agents.some(a => String((a && a.path) || '').includes(PACKAGE_NAME))) {
    console.log(`  opencode.json already references ${PACKAGE_NAME} — nothing to change.`);
    return;
  }

  if (existed) {
    fs.copyFileSync(OPENCODE_CONFIG, OPENCODE_CONFIG + '.bak');
    console.log(`  Backup written to ${OPENCODE_CONFIG}.bak`);
  }

  config.agents.push({ path: configEntryPath() });
  fs.writeFileSync(OPENCODE_CONFIG, JSON.stringify(config, null, 2) + '\n');
  console.log(`  Added agent path to ${OPENCODE_CONFIG}`);
  console.log(`  Restart OpenCode to load the agents.`);
}

function cmdSetup() {
  console.log(`\n  Add this to your opencode.json:\n`);
  console.log(`  {`);
  console.log(`    "agents": [{ "path": "${configEntryPath()}" }]`);
  console.log(`  }\n`);
  console.log(`  Or apply it automatically (backs up your config first):`);
  console.log(`    swe-pro-agents setup --apply\n`);
  console.log(`  Skills are auto-discovered from ~/.config/opencode/skills/ — no config needed.\n`);

  const globalExists = fs.existsSync(GLOBAL_AGENTS_MD);
  const packAgentsMdExists = fs.existsSync(PACK_AGENTS_MD);
  console.log(`  This pack's agents/ files are intentionally short — they rely on`);
  console.log(`  a shared AGENTS.md (Engineering Operating System: Core priorities,`);
  console.log(`  Engineering rules, Completion checklist, Reporting format) being`);
  console.log(`  loaded into context for every agent.\n`);
  if (!packAgentsMdExists) {
    console.log(`  Warning: the pack's AGENTS.md wasn't found at ${PACK_AGENTS_MD}.`);
    console.log(`  Try reinstalling: npm update -g ${PACKAGE_NAME}\n`);
  } else if (globalExists) {
    console.log(`  You have a global AGENTS.md at ${GLOBAL_AGENTS_MD}.`);
    console.log(`  Merge in whatever you want from:\n  ${PACK_AGENTS_MD}\n`);
  } else {
    console.log(`  No global AGENTS.md found. Without one, these agents lose their`);
    console.log(`  shared foundation. Copy it into place:\n`);
    console.log(`    cp "${PACK_AGENTS_MD}" "${GLOBAL_AGENTS_MD}"\n`);
  }
}

function cmdStatus() {
  const agentCount = getAgentCount();
  const skillCount = getSkillCount();
  const installedAgentCount = getInstalledAgentCount();

  console.log(`\n  SWE Pro Agents — Status`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Version:    ${pkg.version}`);
  console.log(`  Agents:     ${agentCount} in package` + (installedAgentCount > 0 ? `, ${installedAgentCount} installed` : ''));
  console.log(`  Skills:     ${skillCount} in package`);

  if (installedAgentCount > 0 && installedAgentCount !== agentCount) {
    console.log(`  Warning: installed agent count (${installedAgentCount}) doesn't match package (${agentCount}). Run 'npm update -g swe-pro-agents'.`);
  }

  // Check if opencode.json references these agents
  const opencodeConfigPath = OPENCODE_CONFIG;
  if (fs.existsSync(opencodeConfigPath)) {
    try {
      const raw = fs.readFileSync(opencodeConfigPath, 'utf-8').replace(/^\uFEFF/, '');
      const config = JSON.parse(raw);
      const agents = config.agents || [];
      const referenced = agents.some(a => (a.path || '').includes(PACKAGE_NAME));
      console.log(`  Config:     ${referenced ? 'Referenced in opencode.json' : 'Not yet added to opencode.json (run: swe-pro-agents setup --apply)'}`);
    } catch {
      console.log(`  Config:     opencode.json found but could not parse`);
    }
  } else {
    console.log(`  Config:     No opencode.json found (run: swe-pro-agents setup --apply)`);
  }

  // Check AGENTS.md — the shared foundation every agent file assumes is loaded
  const packAgentsMdExists = fs.existsSync(PACK_AGENTS_MD);
  const globalAgentsMdExists = fs.existsSync(GLOBAL_AGENTS_MD);
  console.log(`  AGENTS.md:  ${packAgentsMdExists ? 'Installed (package copy present)' : 'MISSING — run npm update'}`);
  if (packAgentsMdExists && !globalAgentsMdExists) {
    console.log(`              Warning: no global AGENTS.md found — agents are missing`);
    console.log(`              their shared Engineering Operating System. Run 'swe-pro-agents setup'.`);
  }

  console.log();
}

function cmdVersion() {
  console.log(pkg.version);
}

// ---------------------------------------------------------------------------
// run — plan-execution loop driver
// ---------------------------------------------------------------------------

/**
 * Strip the CLI-driven-run directive sentence from a cliMode message. The
 * directive literal is exported by scripts/loop-logic.js (the source that
 * composes it), so wording changes there can never silently break
 * --no-continue.
 */
function stripCliDirective(message) {
  return message.replace(CLI_DIRECTIVE, ' ');
}

/**
 * Parse the arguments after `run`. Returns { ok: true, args } or
 * { ok: false, error }.
 */
function parseRunArgs(argv) {
  const args = {
    plan: DEFAULT_PLAN_DIR,
    dryRun: false,
    maxIterations: null,
    noContinue: false,
    json: false,
    result: null,
  };
  const positionals = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--no-continue') {
      args.noContinue = true;
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
    } else if (arg.startsWith('-')) {
      return { ok: false, error: `unknown flag '${arg}'` };
    } else {
      positionals.push(arg);
    }
  }
  if (positionals.length > 1) {
    return { ok: false, error: `unexpected argument '${positionals[1]}'` };
  }
  if (positionals.length === 1) {
    if (positionals[0] !== 'done' && positionals[0] !== 'fail') {
      return { ok: false, error: `unknown result '${positionals[0]}' (expected 'done' or 'fail')` };
    }
    args.result = positionals[0];
  }
  return { ok: true, args };
}

/**
 * Drive the plan-execution loop. One iteration per invocation:
 *
 *   1. Load the ledger from <plan>/state.json; when missing or invalid, init
 *      it from <plan>/tasks.md.
 *   2. When a result ('done'|'fail') is given, record it for the current
 *      in_progress task via applyAttemptResult — the CLI is the single writer
 *      of the ledger, so the continuation message never instructs the agent to
 *      edit it (cliMode).
 *   3. Stop when shouldContinue() is false (summary printed, exit 0).
 *   4. Otherwise dispatch the next task: markInProgress, persist, and print
 *      the task id + dispatch instructions (the cliMode continuation message).
 *
 * Returns the process exit code.
 */
function cmdRun(argv) {
  const parsed = parseRunArgs(argv);
  if (!parsed.ok) {
    usageError(parsed.error);
    return 2;
  }
  const args = parsed.args;

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

  let state = loadState(ledgerPath);
  if (!state) {
    // An existing file that cannot be loaded (corrupt, invalid) is never
    // silently replaced — that would lose recorded progress.
    if (fs.existsSync(ledgerPath)) {
      throw new Error(`ledger exists but could not be loaded: ${ledgerPath}`);
    }
    state = initState(specTasks);
    if (args.maxIterations !== null) {
      state.budget.max_iterations_per_run = args.maxIterations;
    }
    saveState(ledgerPath, state);
  } else if (args.maxIterations !== null) {
    // Override the budget for this run; persisted on the next save.
    state = { ...state, budget: { ...state.budget, max_iterations_per_run: args.maxIterations } };
  }

  // Reconcile the ledger against the current plan spec before dry-run,
  // result handling, or dispatch — tasks.md may have changed since the
  // ledger was created (tasks renamed, added, or removed).
  const synced = syncWithSpec(state, specTasks);
  if (synced.added.length > 0 || synced.removed.length > 0) {
    state = synced.state;
    saveState(ledgerPath, state);
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

  // The CLI records results; the dispatched agent never edits the ledger.
  if (args.result) {
    const inProgress = state.tasks.find((t) => t.status === 'in_progress');
    if (!inProgress) {
      throw new Error(`no in_progress task to record '${args.result}' for`);
    }
    state = applyAttemptResult(state, inProgress.id, args.result);
    saveState(ledgerPath, state);
  }

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
    return 0;
  }

  const task = nextTask(state);
  // Build the message from the pre-dispatch state: buildContinuationMessage
  // resolves the task via nextTask(), which skips in_progress tasks, so the
  // message must be built before markInProgress to name the task being
  // dispatched.
  let message = buildContinuationMessage(state, { cliMode: true });
  if (args.noContinue) message = stripCliDirective(message);
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
  return 0;
}

// ---------------------------------------------------------------------------
// help / usage
// ---------------------------------------------------------------------------

const USAGE = `Usage: swe-pro-agents <command> [options]

Commands:
  run [result] [options]   Drive the plan-execution loop
      result               'done' or 'fail' — record the result of the current
                           in_progress task (the CLI records results; the
                           dispatched agent never edits the ledger)
      --plan <dir>         Plan directory (default: plans/)
      --dry-run            Init the ledger from the plan without dispatching;
                           print the summary and exit 0
      --max-iterations <n> Override the iterations budget (default: 40)
      --no-continue        Print the continuation message without the
                           "CLI-driven run" directive line
      --json               Machine-readable output (JSON on stdout, human text
                           on stderr)
  setup [--apply]          Show the opencode.json config snippet; --apply
                           writes it (with a .bak backup)
  status                   Show installation status + update check
  version                  Show package version
  help                     Show this help

Options:
  -v, --version            Show package version
  -h, --help               Show this help

Exit codes: 0 success, 1 runtime error, 2 usage error.
`;

function cmdHelp() {
  console.log(`SWE Pro Agents v${pkg.version}`);
  console.log(USAGE);
}

function usageError(message) {
  if (message) process.stderr.write(`Error: ${message}\n`);
  process.stderr.write(USAGE);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === undefined) {
    cmdHelp();
    return 0;
  }

  switch (cmd) {
    case 'run':
      return cmdRun(argv.slice(1));
    case 'setup':
      cmdSetup();
      if (argv.includes('--apply')) {
        console.log(`  Applying opencode.json entry...`);
        applyToOpenCodeConfig();
      }
      return 0;
    case 'status':
      cmdStatus();
      // Update check — offline/slow registries silently skip it.
      const latest = await checkForUpdates();
      if (latest) {
        console.log(`  Update:     ${latest} available (you have ${pkg.version}) —`);
        console.log(`              run 'npm update -g ${PACKAGE_NAME}'`);
        console.log();
      }
      return 0;
    case 'version':
    case '-v':
    case '--version':
      cmdVersion();
      return 0;
    case 'help':
    case '-h':
    case '--help':
      cmdHelp();
      return 0;
    default:
      usageError(`unknown command '${cmd}'`);
      return 2;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(`[${PACKAGE_NAME}] Error:`, err.message);
    process.exitCode = 1;
  });