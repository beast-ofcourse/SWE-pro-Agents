'use strict';

/**
 * swe-pro-agents-background.js — OpenCode plugin adapter for background
 * subagents. Thin V1 adapter: defines the tools and wires them to the deep
 * module (scripts/background-delegate.js). Mirrors the pack's install-layout
 * require fallback (see continuation.js / install.js).
 *
 * Tools: bg_delegate, bg_status, bg_read, bg_list, bg_stop, bg_steer, bg_prune.
 * On delegation terminal, the parent session is notified (waiter model).
 *
 * Retention: completed/error/cancelled delegations accumulate on disk. Run
 * bg_prune (default 30 days) to remove old ones; nothing auto-prunes.
 *
 * Non-goal: background delegations NEVER auto-merge. The parent must read the
 * result (bg_read) and integrate it. This agent only runs the subagent and
 * reports back — merging is the user's call.
 */

const path = require('path');
const fs = require('fs');

function resolveDeepModule(repoName, installedName) {
  const candidates = [
    // Installed layout: deep module shipped as a prefixed plugin next to this adapter.
    path.join(__dirname, installedName),
    // Repo layout: developed alongside scripts/.
    path.join(__dirname, '..', 'scripts', repoName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

const { createBackgroundDelegate } = require(resolveDeepModule('background-delegate.js', 'swe-pro-agents-background-delegate.js'));
const { createWorktreeManager } = require(resolveDeepModule('background-worktree.js', 'swe-pro-agents-background-worktree.js'));

/**
 * Best-effort parent notification. Tries client.session.message, then falls back
 * to a prompt nudge. No-ops if neither exists (defensive — API unverified).
 */
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

module.exports = {
  id: 'swe-pro-agents-background',
  server: async (ctx) => {
    const { client, directory } = ctx;

    const wm = createWorktreeManager();
    const bg = createBackgroundDelegate({
      client,
      directory,
      repoDir: directory,
      worktreeManager: wm,
      onTerminal: (id, state) => notifyParent(client, state.parentID, id, state),
    });

    // Crash recovery on load.
    bg.reconcileOrphans().catch(() => {});

    // Supervisor: periodically reconcile so completed children notify the parent
    // even if the parent never calls bg_read. Disable via SWE_PRO_BG_SUPERVISOR=0.
    if (process.env.SWE_PRO_BG_SUPERVISOR !== '0') {
      const ms = parseInt(process.env.SWE_PRO_BG_SUPERVISOR_MS, 10) || 5000;
      let reconciling = false;
      const timer = setInterval(() => {
        if (reconciling) return; // don't overlap a still-in-flight reconciliation
        reconciling = true;
        bg.reconcileOrphans().catch(() => {}).finally(() => {
          reconciling = false;
        });
      }, ms);
      if (timer.unref) timer.unref();
    }

    const requireId = (args, name) => {
      if (!args || !args.id) throw new Error(name + ' requires an id');
      return args.id;
    };

    return {
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
};
