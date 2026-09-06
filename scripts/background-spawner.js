'use strict';

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

module.exports = { TERMINAL_STATES, createSessionSpawner, createNativeSpawnerStub };
