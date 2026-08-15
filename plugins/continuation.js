/**
 * continuation.js — OpenCode plugin: autonomous-loop nudge on session.idle.
 *
 * Doc-verified API (recorded at build time).
 *
 * NOTE ON SOURCE: the context7 lookup FAILED (MCP server returned "Invalid API
 * key. ... API keys should start with 'ctx7sk' prefix."). The API below was
 * verified against the official OpenCode docs and the opencode source
 * (github.com/anomalyco/opencode, default branch `dev`, docs last updated
 * 2026-08-14), plus an empirical loader test run with Bun 1.3.14 (the runtime
 * OpenCode's plugin loader uses). Nothing here is written from memory.
 *
 * 1. Plugin install directory
 *    Project-level: `.opencode/plugins/`; global: `~/.config/opencode/plugins/`.
 *    `.js`/`.ts` files there are auto-loaded at startup (scan glob
 *    `{plugin,plugins}/*.{ts,js}`).
 *    Citation: https://opencode.ai/docs/plugins/ ("Use a plugin — From local
 *    files"); loader scan confirmed in packages/opencode/src/config/plugin.ts.
 *
 * 2. Module export shape
 *    The docs document a plugin as a module that exports one or more plugin
 *    functions; each receives a context object `{ project, client, $,
 *    directory, worktree }` and returns a hooks object (ESM named exports,
 *    e.g. `export const MyPlugin = async (ctx) => ({ ... })`).
 *    Citation: https://opencode.ai/docs/plugins/ ("Create a plugin — Basic
 *    structure").
 *    The current loader first checks `mod.default` for a `{ id, server }`
 *    object (V1 shape), else iterates `Object.values(mod)` for legacy named
 *    function exports (packages/opencode/src/plugin/index.ts: readV1Plugin,
 *    getLegacyPlugins). Empirical test (Bun 1.3.14): a CommonJS module with
 *    `module.exports.X = fn` or `module.exports = fn` FAILS to load — the
 *    loader's `Object.values(mod)` includes `mod.default` (the module.exports
 *    object) and the function's `length`/`name`, which are not functions and
 *    make getLegacyPlugins throw "Plugin export is not a function". The ONLY
 *    CommonJS shape the current loader accepts is a default export object
 *    `{ id, server }` (verified by simulating readV1Plugin + getLegacyPlugins
 *    against all four shapes). This file therefore uses that shape — the
 *    zero-dependency CommonJS equivalent of the documented plugin function.
 *    The `server` function receives the same plugin context (incl. `client`)
 *    and returns the same hooks object as the documented named-function shape.
 *
 * 3. Hook signature
 *    `session.idle` is delivered through the `event` hook:
 *    `event: async ({ event }) => { if (event.type === "session.idle") ... }`.
 *    The event payload carries the idle session's ID at
 *    `event.properties.sessionID`.
 *    Citations: https://opencode.ai/docs/plugins/ ("Events — Session Events",
 *    "Examples — Send notifications"); dispatch confirmed in
 *    packages/opencode/src/plugin/index.ts (`hook["event"]?.({ event: { id,
 *    type, properties } })`); payload shape confirmed in the opencode SDK
 *    event types (SessionIdleProps, serde rename "sessionID").
 *
 * 4. Resuming the agent
 *    `client.session.prompt({ path: { id }, body: { agent, parts: [{ type:
 *    "text", text }] } })` — `body.agent` and `body.parts` are documented in
 *    the SDK's SessionPromptData type.
 *    Citations: https://opencode.ai/docs/sdk/ ("Sessions — session.prompt");
 *    https://github.com/anomalyco/opencode/blob/dev/packages/sdk/js/src/gen/types.gen.ts
 *    (SessionPromptData.body.agent / body.parts).
 *
 * 5. Session agent guard
 *    `client.session.get({ path: { id } })` returns the session; its `agent`
 *    field identifies the active agent.
 *    Citation: opencode server source, packages/opencode/src/session/session.ts
 *    (Info.agent).
 *
 * Behavior: on session.idle, if the session's agent is `swe-pro` and
 * plans/state.json (relative to the project cwd) reports status "running" with
 * at least one pending task and no in_progress task, prompt the session to
 * continue plan execution. Every failure path returns silently; the hook never
 * throws.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const NUDGE_MESSAGE =
  'Autonomous loop: continue plan execution per plans/state.json. Load and validate the ledger, dispatch the next task, verify it, record the result, and end with <promise>DONE</promise>.';

const stateFile = () => path.join(process.cwd(), 'plans', 'state.json');

/**
 * Read plans/state.json. Returns the parsed object, or null when the file is
 * missing, unreadable, or not a JSON object (caller treats null as "do
 * nothing").
 */
function readState() {
  let raw;
  try {
    raw = fs.readFileSync(stateFile(), 'utf8');
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

/**
 * Decide whether the ledger wants the loop resumed. True only when the ledger
 * status is "running", no task is in_progress, and at least one task is
 * pending.
 */
function shouldResume(state) {
  if (!state || state.status !== 'running') return false;
  if (!Array.isArray(state.tasks)) return false;
  if (state.tasks.some((task) => task && task.status === 'in_progress')) return false;
  return state.tasks.some((task) => task && task.status === 'pending');
}

module.exports = {
  id: 'swe-pro-continuation',
  server: async ({ client }) => {
    return {
      event: async ({ event }) => {
        try {
          if (!event || event.type !== 'session.idle') return;
          const sessionID = event.properties && event.properties.sessionID;
          if (!sessionID) return;

          // Agent guard: never hijack architect/planning sessions.
          const session = await client.session.get({ path: { id: sessionID } });
          if (!session || session.agent !== 'swe-pro') return;

          const state = readState();
          if (!shouldResume(state)) return;

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
    };
  },
};