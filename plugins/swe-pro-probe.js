'use strict';

/**
 * swe-pro-probe.js — DEV-ONLY harness for the Phase 0 spawn probe.
 *
 * NOT registered in scripts/install.js, so it is never shipped by the pack.
 * Its only job is to give scripts/probe-spawn.js a live in-process `ctx.client`
 * by exposing a `probe_spawn` tool that the user invokes from inside a real
 * opencode session. This resolves the plan's contradiction: the probe logic is a
 * plain (non-plugin) module, but it can only execute where `ctx.client` exists.
 *
 * To run Phase 0 (Task 0.2):
 *   1. Copy or symlink this file into an opencode plugin dir:
 *        .opencode/plugins/swe-pro-probe.js   (project) or
 *        ~/.config/opencode/plugins/swe-pro-probe.js  (global)
 *   2. Start opencode in this project.
 *   3. Call the tool:  /probe_spawn
 *   4. Read the PASS/FAIL + diagnostics output.
 *
 * If the tool fails to register (schema shape differs across opencode versions),
 * the diagnostics in probe-spawn.js are designed to surface the real API shape —
 * adjust the `args` block below to match and re-run.
 */

const path = require('path');
const fs = require('fs');

function resolveProbeScript() {
  const candidates = [
    path.join(__dirname, '..', 'scripts', 'probe-spawn.js'), // plugin lives in repo plugins/
    path.join(__dirname, '..', '..', 'scripts', 'probe-spawn.js'), // plugin copied to .opencode/plugins/
    path.join(process.cwd(), 'scripts', 'probe-spawn.js'), // opencode cwd is the repo root
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0];
}

const { probeSpawn, renderReport } = require(resolveProbeScript());

module.exports = {
  id: 'swe-pro-probe',
  server: async (ctx) => {
    const { client, directory } = ctx;

    return {
      tool: {
        probe_spawn: {
          description:
            'Phase 0 hard-gate probe: verify background child-session spawn + fire-and-forget prompt works in-process. Returns PASS/FAIL with diagnostics. Dev-only.',
          args: {
            agent: { type: 'string', required: false, description: 'Agent to spawn for the probe (default swe-repository).' },
            prompt: { type: 'string', required: false, description: 'Prompt sent to the child (default a short reasoning task).' },
            timeoutMs: { type: 'number', required: false, description: 'Max wait for child completion in ms (default 60000).' },
          },
          async execute(args, toolCtx) {
            const opts = {};
            if (args && args.agent) opts.agent = args.agent;
            if (args && args.prompt) opts.prompt = args.prompt;
            if (args && typeof args.timeoutMs === 'number') opts.timeoutMs = args.timeoutMs;
            const sessionID = (toolCtx && toolCtx.sessionID) || (ctx && ctx.session && ctx.session.id);
            if (sessionID) opts.parentID = sessionID;

            const report = await probeSpawn({ client, directory, sessionID }, opts);
            return renderReport(report);
          },
        },
      },
    };
  },
};
