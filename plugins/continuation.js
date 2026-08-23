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
 * 6. Goal-gate mechanism (T-017, pinned 2026-08-15) — PRIMARY design
 *    The plugin arms/disarms per-session state on the `command.executed`
 *    event (in-memory Map keyed by sessionID). Verified against the opencode
 *    source (github.com/anomalyco/opencode, default branch `dev`) and the
 *    goal-plugin docs; nothing here is written from memory.
 *
 *    a. Payload: `command.executed` identifies the executed command at
 *       `event.properties.name` (string). Full payload:
 *       `{ name, sessionID, arguments, messageID }`.
 *       Citations: packages/schema/src/v1/legacy-event.ts (CommandExecuted
 *       schema: `name: Schema.String`, `arguments: Schema.String`);
 *       packages/opencode/src/session/prompt.ts lines 1474-1479
 *       (`events.publish(Command.Event.Executed, { name: input.command,
 *       sessionID, arguments: input.arguments, messageID })`); plugin
 *       delivery `hook["event"]?.({ event: { id, type, properties:
 *       event.data } })` in packages/opencode/src/plugin/index.ts lines
 *       253-257.
 *
 *    b. Firing: `command.executed` fires for slash commands that are
 *       registered server-side. The TUI routes `/cmd` to the server
 *       `session.command` RPC only when the name is in the server command
 *       list (`sync.data.command`, populated from `client.command.list`),
 *       and the server publishes the event from `SessionPrompt.command`.
 *       TUI-local commands (e.g. `session.share`, `session.rename`) never
 *       reach the server and never fire it.
 *       Citations: packages/tui/src/component/prompt/index.tsx (submitInner:
 *       `sync.data.command.some((x) => x.name === ...)` gate before
 *       `sdk.client.session.command({ command: command.slice(1), ... })`);
 *       packages/tui/src/context/sync.tsx line 523 (`client.command.list`);
 *       packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts
 *       lines 331-337 and 433 (`session.command` route -> SessionPrompt.command).
 *
 *    c. `/goal` IS server-registered by the goal plugins, so the event fires
 *       for it. prevalentWare/opencode-goal-plugin registers
 *       `config.command["goal"]` (a server config command; `register_command`
 *       defaults true, `command_name` defaults "goal") — src/server.ts lines
 *       153-158, 734-735, 884-885. OpenCode PR #28610 registers a built-in
 *       skill named "goal" (packages/opencode/src/skill/index.ts,
 *       GOAL_SKILL_NAME = "goal"), and skills become server commands
 *       (packages/opencode/src/command/index.ts). Both config commands and
 *       skills land in the server command registry, so the TUI routes `/goal`
 *       to the server and `command.executed` fires.
 *
 *    d. Names to match: `event.properties.name === "goal"` for every goal
 *       invocation; the subcommand arrives in `event.properties.arguments`
 *       (trimmed): "" or an objective -> arm; "clear" -> disarm; "pause" ->
 *       pause; "resume" -> resume. Clear aliases per the prevalentWare README:
 *       stop, off, reset, none, cancel. The `name` field never carries the
 *       subcommand — it is always the registered command name.
 *
 *    e. The event fires even for pause/resume/clear: the goal plugin's
 *       `command.execute.before` hook only rewrites `output.parts`;
 *       `command.executed` is published unconditionally after `prompt()`
 *       (prompt.ts lines 1460-1479).
 *
 *    T-018 implements the gate via LoopGate module (scripts/loop-gate.js).
 *    This file is the thin adapter at the OpenCode seam.
 *
 * Behavior: on session.idle, if the session's agent is `swe-pro`, the session
 * has an active goal (armed via `command.executed` for `/goal`), and
 * plans/state.json (relative to the plugin context `directory`) reports status
 * "running" with at least one pending task and no in_progress task, prompt the
 * session to continue plan execution. Every failure path returns silently; the
 * hook never throws.
 */

'use strict';

const path = require('path');

// Resolve LoopGate for both repo (scripts/loop-gate.js) and installed
// (same dir, prefixed name swe-pro-agents-loop-gate.js) layouts.
// Installed: __filename is .../swe-pro-agents-continuation.js → same dir.
// Repo: __filename is .../plugins/continuation.js → ../scripts/loop-gate.js.
let gate;
try {
  // Installed layout — same plugin dir, prefixed
  gate = require('./swe-pro-agents-loop-gate.js');
} catch {}
if (!gate) {
  try {
    gate = require('../scripts/loop-gate.js');
  } catch {}
}
if (!gate) {
  // Should not happen; keep plugin loadable but nudge will be no-op
  gate = {
    handleGoalEvent: () => ({ handled: false }),
    shouldNudge: () => false,
    NUDGE_MESSAGE:
      'Autonomous loop: continue plan execution per plans/state.json. Load and validate the ledger, dispatch the next task, verify it, record the result, and end with <promise>DONE</promise>.',
  };
}

const NUDGE_MESSAGE = gate.NUDGE_MESSAGE;

module.exports = {
  id: 'swe-pro-continuation',
  server: async ({ client, directory }) => {
    return {
      config: async (config) => {
        // Pack-shipped /goal — registers the slash command so command.executed fires
        // without any external plugin. Template uses $ARGUMENTS per
        // packages/opencode/src/cli/cmd/run/footer.prompt.tsx and
        // opencode.json docs (command[].template). The template instructs the
        // agent to handle subcommands consistent with LoopGate.
        try {
          config.command = config.command || {};
          if (!config.command['goal']) {
            config.command['goal'] = {
              template:
                'Handle the /goal slash command. User arguments: $ARGUMENTS\n\n' +
                'Parse arguments.trim().toLowerCase():\n' +
                '- "" or objective (including "resume" with or without objective) → Goal set: "<args>" — loop armed. Reply one line + help.\n' +
                '- "show" | "status" | "help" → report current goal (best-effort from history; if none, "No active goal remembered") + ledger summary if you can read plans/state.json (display only) + Usage: /goal [<objective>] | /goal show | /goal pause|resume | /goal clear (aliases: stop,off,reset,none,cancel)\n' +
                '- "pause" → Goal paused — loop disarmed. Use /goal resume to continue.\n' +
                '- "clear" | "stop" | "off" | "reset" | "none" | "cancel" → Goal cleared — loop disarmed. Idempotent.\n' +
                'Never modify plans/state.json for goal — the continuation plugin owns armedSessions, the ledger owns tasks. Note: this invocation arms/disarms the gate via command.executed. Fail-closed: restart requires fresh /goal. Headless swe-pro-agents run needs no /goal.',
              description: 'Set, show, pause, resume, or clear the active thread goal — arms the autonomous loop',
              agent: 'swe-pro',
            };
          }
        } catch {}
      },
      event: async ({ event }) => {
        try {
          if (!event || !event.type) return;

          // The event hook receives every event type; dispatch on it.
          if (event.type === 'command.executed') {
            gate.handleGoalEvent(event);
            return;
          }
          if (event.type !== 'session.idle') return;

          const sessionID = event.properties && event.properties.sessionID;
          if (!sessionID) return;

          // Agent guard is inside shouldNudge, but we need sessionAgent — fetch it here (adapter concern).
          const session = await client.session.get({ path: { id: sessionID } });
          const sessionAgent = session && session.agent;

          if (!gate.shouldNudge({ directory, sessionID, sessionAgent })) return;

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
