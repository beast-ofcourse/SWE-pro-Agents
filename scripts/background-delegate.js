'use strict';

/**
 * background-delegate.js — core background-subagent delegation engine.
 *
 * Deep module (kept out of the plugin adapter per pack convention). Owns:
 *   - stable delegation IDs + disk-persisted state (<id>.json) and result (<id>.md)
 *   - lifecycle: registered -> running -> terminal (completed|error|cancelled)
 *   - concurrency limiting + priority queue
 *   - crash recovery (orphan re-adoption)
 *   - the spawn seam (spawnDelegation) — SDK child-session path is PRIMARY because
 *     Phase 0 PASSED; the native task(background=true) pivot is not active.
 *
 * Built against the verified in-process ctx.client contract (OpenCode v1.18.11):
 *   - session.create / session.get return wrapped { data, request, response }
 *   - session has no `state`/`parts` field; completion = tokens.output > 0
 *   - session.prompt is fire-and-forget; agent is set on the PROMPT body
 *
 * Testable: pass a fake `client` and a temp `storeDir` via createBackgroundDelegate.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

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
    fs.writeFileSync(statePath(state.id), JSON.stringify(state, null, 2));
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

  // --- spawn seam (Phase 0 passed -> SDK child-session path active) ---
  async function spawnDelegation(id, opts) {
    const createArgs = { body: { title: opts.title || 'background-delegation', parentID: opts.parentID } };
    if (opts.directory) createArgs.query = { directory: opts.directory };
    const child = unwrap(await client.session.create(createArgs));
    const childID = child && child.id;
    if (!childID) throw new Error('spawnDelegation: session.create returned no id');

    const promptBody = { parts: [{ type: 'text', text: opts.prompt }] };
    if (opts.agent) promptBody.agent = opts.agent; // agent on prompt body (create body is ignored)
    if (opts.model) promptBody.model = opts.model;
    client.session.prompt({ path: { id: childID }, body: promptBody }).catch(() => {}); // fire-and-forget
    return childID;
  }

  async function startDelegation(id) {
    const state = readState(id);
    if (!state) throw new Error('startDelegation: unknown id ' + id);
    if (state.state === 'running' || state.state === 'completed') return;
    const childID = await spawnDelegation(id, state);
    state.childSessionID = childID;
    state.state = 'running';
    writeState(state);
    running.add(id);
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

    if (running.size < maxParallel) {
      await startDelegation(id);
    } else {
      queue.push({ id, priority: state.priority });
      queue.sort((a, b) => b.priority - a.priority);
    }
    return id;
  }

  async function finalizeDelegation(id, resultMarkdown) {
    const state = readState(id);
    if (!state) throw new Error('finalizeDelegation: unknown id ' + id);
    if (state.state === 'completed' || state.state === 'error' || state.state === 'cancelled') {
      return state; // terminal-state protection
    }
    fs.writeFileSync(markdownPath(id), resultMarkdown || '');
    state.state = 'completed';
    state.summary = (resultMarkdown || '').split('\n')[0].slice(0, 120);
    writeState(state);
    if (onTerminal) onTerminal(id, state);
    running.delete(id);
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
    const state = readState(id);
    if (!state) throw new Error('readDelegation: unknown id ' + id);
    if (state.state === 'completed') {
      try {
        return fs.readFileSync(markdownPath(id), 'utf-8');
      } catch {
        return '';
      }
    }
    if (state.state === 'error' || state.state === 'cancelled') {
      return 'terminal: ' + state.state;
    }
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await childIsComplete(state.childSessionID)) {
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
      });
    }
    return out;
  }

  async function reconcileOrphans() {
    ensureStore();
    const files = fs.readdirSync(storeDir).filter((f) => f.endsWith('.json'));
    for (const f of files) {
      const st = readState(f.replace('.json', ''));
      if (!st) continue;
      if (st.state !== 'registered' && st.state !== 'running') continue;
      const complete = await childIsComplete(st.childSessionID);
      if (complete) {
        const result = await fetchChildResult(st.childSessionID);
        await finalizeDelegation(st.id, result || '(reconciled)');
      } else if (st.state === 'registered' && !running.has(st.id) && !queue.find((q) => q.id === st.id)) {
        if (running.size < maxParallel) await startDelegation(st.id);
        else {
          queue.push({ id: st.id, priority: st.priority });
          await dequeue();
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

module.exports = {
  createBackgroundDelegate,
  resolveStoreDir,
  unwrap,
  readOutputTokens,
  DEFAULT_MAX_PARALLEL,
  DEFAULT_READ_TIMEOUT_MS,
};
