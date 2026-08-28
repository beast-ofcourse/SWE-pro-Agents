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

// ---------------------------------------------------------------------------
// Feature flag: /goal enablement (mirrors scripts/pack-config.js isGoalEnabled)
// ---------------------------------------------------------------------------
const GOAL_CONFIG_FILE = 'swe-pro-agents.config.json';

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
    const c = loadGoalConfig(directory);
    return !!(c.features && c.features.goal !== false);
  } catch {
    return true;
  }
}

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

// ---------------------------------------------------------------------------
// Deep module: background-worktree (git worktree isolation for write-mode)
// ---------------------------------------------------------------------------
function createWorktreeManager(deps) {
  const execGit =
    deps && typeof deps.execGit === 'function'
      ? deps.execGit
      : (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

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

  return { setup, remove, branchExists };
}

// ---------------------------------------------------------------------------
// Deep module: background-delegate (delegation engine)
// ---------------------------------------------------------------------------
const DEFAULT_MAX_PARALLEL = 4;
const DEFAULT_READ_TIMEOUT_MS = 900000;
const STORE_DIRNAME = 'swe-pro-delegations';

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

function readOutputTokens(session) {
  if (!session || typeof session !== 'object') return 0;
  const tokens = session.tokens;
  if (tokens && typeof tokens.output === 'number') return tokens.output;
  return 0;
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
  const worktreeManager = deps.worktreeManager || null;
  const repoDir = deps.repoDir || null;
  const onTerminal = typeof deps.onTerminal === 'function' ? deps.onTerminal : null;

  const running = new Set();
  const queue = []; // { id, priority }

  const statePath = (id) => path.join(storeDir, id + '.json');
  const markdownPath = (id) => path.join(storeDir, id + '.md');

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

  function writeState(state) {
    state.updatedAt = Date.now();
    const target = statePath(state.id);
    const tmp = target + '.tmp-' + process.pid + '-' + crypto.randomUUID().slice(0, 8);
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, target);
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
    const createArgs = { body: { title: opts.title || 'background-delegation', parentID: opts.parentID } };
    if (opts.directory) createArgs.query = { directory: opts.directory };
    const child = unwrap(await client.session.create(createArgs));
    const childID = child && child.id;
    if (!childID) throw new Error('spawnDelegation: session.create returned no id');

    const promptBody = { parts: [{ type: 'text', text: opts.prompt }] };
    if (opts.agent) promptBody.agent = opts.agent;
    if (opts.model) promptBody.model = opts.model;
    client.session.prompt({ path: { id: childID }, body: promptBody }).catch(() => {});
    return childID;
  }

  async function startDelegation(id) {
    const state = readState(id);
    if (!state) throw new Error('startDelegation: unknown id ' + id);
    if (state.state === 'running' || state.state === 'completed' || state.state === 'error' || state.state === 'cancelled') return;
    running.add(id);
    try {
      const childID = await spawnDelegation(id, state);
      state.childSessionID = childID;
      state.state = 'running';
      writeState(state);
    } catch (err) {
      running.delete(id);
      throw err;
    }
  }

  async function dequeue() {
    if (queue.length === 0 || running.size >= maxParallel) return;
    const next = queue.shift();
    try {
      await startDelegation(next.id);
    } catch {
      const st = readState(next.id);
      if (st) {
        st.state = 'error';
        st.summary = 'failed to start';
        writeState(st);
      }
      running.delete(next.id);
    }
  }

  async function createDelegation(opts = {}) {
    ensureStore();
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
    };
    writeState(state);

    try {
      if (running.size < maxParallel) {
        await startDelegation(id);
      } else {
        queue.push({ id, priority: state.priority });
        queue.sort((a, b) => b.priority - a.priority);
      }
    } catch (err) {
      if (worktree && worktreeManager) {
        try {
          await worktreeManager.remove(worktree);
        } catch {
          /* best-effort */
        }
      }
      state.state = 'error';
      state.summary = 'failed to start: ' + (err && err.message ? err.message : String(err));
      writeState(state);
      throw err;
    }
    return id;
  }

  async function finalizeDelegation(id, resultMarkdown) {
    const state = readState(id);
    if (!state) throw new Error('finalizeDelegation: unknown id ' + id);
    if (state.state === 'completed' || state.state === 'error' || state.state === 'cancelled') {
      return state;
    }
    fs.writeFileSync(markdownPath(id), resultMarkdown || '');
    state.state = 'completed';
    state.summary = (resultMarkdown || '').split('\n')[0].slice(0, 120);
    writeState(state);
    if (onTerminal) onTerminal(id, state);
    running.delete(id);
    const fi = queue.findIndex((q) => q.id === id);
    if (fi !== -1) queue.splice(fi, 1);
    await dequeue();
    return state;
  }

  async function stopDelegation(id) {
    const state = readState(id);
    if (!state) throw new Error('stopDelegation: unknown id ' + id);
    if (state.childSessionID && client.session && client.session.abort) {
      try {
        await client.session.abort({ path: { id: state.childSessionID } });
      } catch {
        /* child may already be gone */
      }
    }
    if (state.mode === 'worktree' && state.worktree && worktreeManager) {
      try {
        await worktreeManager.remove(state.worktree);
      } catch {
        /* best-effort */
      }
    }
    state.state = 'cancelled';
    writeState(state);
    if (onTerminal) onTerminal(id, state);
    running.delete(id);
    const si = queue.findIndex((q) => q.id === id);
    if (si !== -1) queue.splice(si, 1);
    await dequeue();
    return state;
  }

  async function childIsComplete(childSessionID) {
    if (!childSessionID) return false;
    try {
      const s = unwrap(await client.session.get({ path: { id: childSessionID } }));
      const st = s && (s.state || s.status);
      if (st === 'completed' || st === 'error' || st === 'cancelled') return true;
      if (readOutputTokens(s) > 0) return true;
      return false;
    } catch {
      return false;
    }
  }

  async function readDelegation(id, timeoutMs = DEFAULT_READ_TIMEOUT_MS) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const state = readState(id);
      if (!state) throw new Error('readDelegation: unknown id ' + id);
      if (state.state === 'completed') {
        try {
          return fs.readFileSync(markdownPath(id), 'utf-8');
        } catch {
          return '';
        }
      }
      if (state.state === 'error' || state.state === 'cancelled') return 'terminal: ' + state.state;
      if (state.childSessionID && (await childIsComplete(state.childSessionID))) {
        const result = await fetchChildResult(state.childSessionID);
        await finalizeDelegation(id, result || '(no result captured)');
        return result || '(no result captured)';
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
      out.push({
        id: st.id,
        state: st.state,
        title: st.title,
        summary: st.summary,
        agent: st.agent,
        mode: st.mode,
        childSessionID: st.childSessionID || null,
      });
    }
    return out;
  }

  async function reconcileOrphans() {
    ensureStore();
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith('.json'));
    const orphans = [];
    for (const f of files) {
      const st = readState(f.replace('.json', ''));
      if (!st) continue;
      if (st.state !== 'registered' && st.state !== 'running') continue;
      orphans.push(st);
    }
    orphans.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    for (const st of orphans) {
      const complete = await childIsComplete(st.childSessionID);
      if (complete) {
        const result = await fetchChildResult(st.childSessionID);
        await finalizeDelegation(st.id, result || '(reconciled)');
      } else if (st.state === 'registered' && !running.has(st.id) && !queue.find((q) => q.id === st.id)) {
        if (running.size < maxParallel) await startDelegation(st.id);
        else {
          queue.push({ id: st.id, priority: st.priority });
          queue.sort((a, b) => b.priority - a.priority);
        }
      }
    }
  }

  async function pruneDelegations(maxAgeDays = 30) {
    ensureStore();
    const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith('.json'));
    let removed = 0;
    for (const f of files) {
      const st = readState(f.replace('.json', ''));
      if (!st) continue;
      if (st.state !== 'completed' && st.state !== 'error' && st.state !== 'cancelled') continue;
      const ts = st.updatedAt || st.createdAt || 0;
      if (now - ts > maxAgeMs) {
        try {
          fs.rmSync(markdownPath(st.id), { force: true });
          fs.rmSync(statePath(st.id), { force: true });
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
    stopDelegation,
    reconcileOrphans,
    spawnDelegation,
    pruneDelegations,
    _internals: { running, queue, storeDir, maxParallel, readState, writeState, startDelegation, dequeue, ensureStore },
  };
}

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
              template:
                'Handle the /goal slash command. User arguments: $ARGUMENTS\n\n' +
                'Parse arguments.trim().toLowerCase():\n' +
                '- "" or objective (including "resume" with or without objective) → Goal set: "<args>" — loop armed. Reply one line + help.\n' +
                '- "show" | "status" | "help" → report current goal (best-effort from history; if none, "No active goal remembered") + ledger summary if you can read plans/state.json (display only) + Usage: /goal [<objective>] | /goal show | /goal pause|resume | /goal clear (aliases: stop,off,reset,none,cancel). These are READ-ONLY — they do NOT arm or disarm the loop.\n' +
                '- "pause" → Goal paused — loop disarmed. Use /goal resume to continue.\n' +
                '- "clear" | "stop" | "off" | "reset" | "none" | "cancel" → Goal cleared — loop disarmed. Idempotent.\n' +
                'Never modify plans/state.json for goal — the continuation plugin owns armedSessions, the ledger owns tasks. Note: this invocation arms/disarms the gate via command.executed (show/status/help do not). Fail-closed: restart requires fresh /goal. Headless swe-pro-agents run needs no /goal.',
              description: 'Set, show, pause, resume, or clear the active thread goal (show/status/help are read-only)',
              agent: 'swe-pro',
            };
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
            'Launch a background subagent (fire-and-forget). Returns a stable delegation ID immediately; the child runs in the background. Read its result later with bg_read.',
          args: {
            prompt: { type: 'string', required: true, description: 'Instruction for the background subagent.' },
            agent: { type: 'string', required: false, description: 'Agent to use (best-effort; child may inherit the parent agent).' },
            mode: { type: 'string', required: false, description: 'readonly | worktree (default readonly).' },
            model: { type: 'string', required: false, description: 'Model override (raises scheduling priority).' },
            title: { type: 'string', required: false, description: 'Human-readable title.' },
          },
          async execute(args, toolCtx) {
            if (!args || !args.prompt) return 'bg_delegate error: prompt is required';
            const parentID = (toolCtx && toolCtx.sessionID) || (ctx.session && ctx.session.id) || null;
            const id = await bg.createDelegation({
              prompt: args.prompt,
              agent: args.agent,
              mode: args.mode,
              model: args.model,
              title: args.title,
              parentID,
              directory,
            });
            return `delegated ${id} (background). Read with bg_read.`;
          },
        },

        bg_status: {
          description: 'Poll one or all delegations: registered/running/completed/error/cancelled + summary.',
          args: { id: { type: 'string', required: false, description: 'Delegation ID, or omit for all.' } },
          async execute(args) {
            const list = await bg.listDelegations();
            if (args && args.id) {
              const found = list.find((l) => l.id === args.id);
              return found ? JSON.stringify(found) : `no delegation ${args.id}`;
            }
            return JSON.stringify(list, null, 2);
          },
        },

        bg_read: {
          description:
            'Block until a delegation is terminal or timeout, then return its persisted result. Default timeout 15 min. Never hangs beyond timeoutMs.',
          args: {
            id: { type: 'string', required: true, description: 'Delegation ID.' },
            timeoutMs: { type: 'number', required: false, description: 'Max wait in ms (default 900000).' },
          },
          async execute(args) {
            const id = requireId(args, 'bg_read');
            const timeout = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined;
            return await bg.readDelegation(id, timeout);
          },
        },

        bg_list: {
          description: 'List all delegations with auto title + summary for scanability.',
          args: {},
          async execute() {
            return JSON.stringify(await bg.listDelegations(), null, 2);
          },
        },

        bg_stop: {
          description:
            'Abort/cancel a running delegation (supervisor control). For worktree mode also removes the worktree.',
          args: { id: { type: 'string', required: true, description: 'Delegation ID.' } },
          async execute(args) {
            const id = requireId(args, 'bg_stop');
            const st = await bg.stopDelegation(id);
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
      },
    };
  },

  // Exports for tests / introspection (not part of the OpenCode plugin seam).
  createBackgroundDelegate,
  createWorktreeManager,
  resolveStoreDir,
  unwrap,
  readOutputTokens,
  DEFAULT_MAX_PARALLEL,
  DEFAULT_READ_TIMEOUT_MS,
  LOOP_AGENT,
  DISARM_SUBCOMMANDS,
  NUDGE_MESSAGE,
  handleGoalEvent,
  isArmed,
  shouldNudge,
  explain,
  reset: resetGate,
  _readState: gateReadState,
  _shouldResume: ledgerResumable,
  _stateFile: gateStateFile,
};
