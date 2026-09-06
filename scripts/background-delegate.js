'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');
const { createJournal } = require('./background-journal');
const { createSessionSpawner, TERMINAL_STATES } = require('./background-spawner');
const { redact, redactDeep, validateResult } = require('./background-results');
const { createScheduler, keyFor } = require('./background-scheduler');

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
    const parentDepth = opts.parentID ? (readState(opts.parentID)?.depth || 1) : 0;
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
    if (opts.parentID) {
      const parentState = readState(opts.parentID);
      if (parentState) {
        if (!Array.isArray(parentState.children)) parentState.children = [];
        parentState.children.push(id);
        // Parent bookkeeping only — not a lifecycle transition of the parent,
        // so no journal line here.
        writeState(parentState);
      }
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
  // scheduled tasks, heartbeat-stale interrupt, session-gone error, and whole-
  // delegation ttl interrupt. A null lastActivityAt (spawner found no real
  // timestamp field) disables ONLY the stale leg — ttl still applies — so we
  // never false-interrupt a live child. Refreshes heartbeatAt from the live
  // activity BEFORE the stale check. Returns the terminal state on transition,
  // null when the delegation is still live. Caller treats the result as
  // terminal (interrupt/error) or keeps polling.
  async function evaluateTerminal(id) {
    const state = readState(id);
    if (!state) return null;
    if (state.state !== 'scheduled' && state.state !== 'running') return null;
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
    if (state.state === 'scheduled' && now - state.createdAt > admissionTimeoutMs) {
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

module.exports = { createBackgroundDelegate, resolveStoreDir, unwrap, DEFAULT_MAX_PARALLEL, DEFAULT_READ_TIMEOUT_MS };
