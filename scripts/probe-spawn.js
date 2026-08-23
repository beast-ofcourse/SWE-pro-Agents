'use strict';

/**
 * probe-spawn.js — Phase 0 hard-gate probe for the background-subagent plan.
 *
 * DEV-ONLY. This is NOT a plugin. It holds the pure probe logic and requires a
 * live in-process `ctx.client` (the OpenCode plugin client), which only exists
 * inside a plugin's execution context. It therefore CANNOT be run via bare
 * `node scripts/probe-spawn.js` — use plugins/swe-pro-probe.js (a dev-only
 * plugin harness) to invoke it from within a real opencode session.
 *
 * Assertions (plans/background-subagents.md Phase 0):
 *   A1 — child executes: a NEW child session, created via
 *        ctx.client.session.create + prompted, reaches `completed` with
 *        >0 assistant parts.
 *   A2 — fire-and-forget: session.prompt returns control immediately (does not
 *        block until the child finishes). Proven by asserting the child's state
 *        is still `running` (not already `completed`) immediately after the
 *        non-awaited prompt call.
 *
 * The in-process client API is richer than the published external SDK and is not
 * fully typed, so every call is defensive and the raw response shapes are
 * captured in `diagnostics` for inspection.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The in-process ctx.client wraps every response as
 * `{ data: <payload>, request, response }` (observed live). Unwrap so the probe
 * reads the real session object regardless of wrapper presence.
 */
function unwrap(res) {
  if (res && typeof res === 'object' && res.data !== undefined) return res.data;
  return res;
}

function readState(session) {
  if (!session || typeof session !== 'object') return undefined;
  return session.state !== undefined ? session.state : session.status;
}

/**
 * This API version (observed 1.18.11) exposes NO `state`/`parts` field on the
 * session object. Execution is proven by `tokens.output > 0` (the model ran and
 * produced a response). We use that as the completion/execution signal.
 */
function readOutputTokens(session) {
  if (!session || typeof session !== 'object') return 0;
  const tokens = session.tokens;
  if (tokens && typeof tokens.output === 'number') return tokens.output;
  return 0;
}

function countAssistantParts(session) {
  if (!session || typeof session !== 'object') return 0;
  for (const field of [session.parts, session.messages, session.response]) {
    if (!Array.isArray(field)) continue;
    let count = 0;
    for (const item of field) {
      if (!item || typeof item !== 'object') continue;
      const type = item.type;
      const role = item.role;
      if (type === 'assistant' || role === 'assistant' || role === 'model') count += 1;
    }
    if (count > 0) return count;
  }
  return 0;
}

function hasPartsField(session) {
  return !!(session && (session.parts || session.messages || session.response));
}

async function probeSpawn(ctx, opts = {}) {
  const {
    agent = 'swe-repository',
    prompt = 'Reply with a 2-sentence explanation of what a git worktree is.',
    timeoutMs = 60000,
    parentID,
    pollMs = 1000,
  } = opts;

  const report = {
    ok: false,
    a1: { pass: false, reason: '' },
    a2: { pass: false, reason: '' },
    diagnostics: {},
  };

  const client = ctx && ctx.client;
  if (!client || !client.session || typeof client.session.create !== 'function') {
    const msg =
      'ctx.client.session.create unavailable — probe must run inside an opencode plugin context (use plugins/swe-pro-probe.js).';
    report.a1.reason = msg;
    report.a2.reason = msg;
    return report;
  }

  const directory = ctx.directory || ctx.cwd || process.cwd();

  // --- Create a NEW child session (the core #8528 risk) ---
  let child;
  try {
    const createArgs = { body: { title: 'probe-spawn', agent } };
    if (parentID) createArgs.body.parentID = parentID;
    if (directory) createArgs.query = { directory };
    child = unwrap(await client.session.create(createArgs));
  } catch (err) {
    report.a1.reason = `session.create threw: ${err && err.message ? err.message : String(err)}`;
    report.diagnostics.createError = err && err.stack ? err.stack : String(err);
    return report;
  }

  const childID = child && child.id;
  if (!childID) {
    report.a1.reason = 'session.create returned no id (even after unwrap)';
    report.diagnostics.createData = child;
    return report;
  }
  report.diagnostics.childID = childID;

  // --- Fire prompt WITHOUT await (fire-and-forget) ---
  let promptPromise;
  try {
    promptPromise = client.session.prompt({
      path: { id: childID },
      body: { parts: [{ type: 'text', text: prompt }] },
    });
    if (promptPromise && typeof promptPromise.catch === 'function') {
      // Swallow late rejection; we determine outcome by polling state, not by awaiting.
      promptPromise.catch(() => {});
    }
  } catch (err) {
    report.a2.reason = `session.prompt threw synchronously: ${err && err.message ? err.message : String(err)}`;
    report.diagnostics.promptError = String(err);
    return report;
  }

  // --- A2: inspect state immediately (must be running, not completed) ---
  let snap;
  try {
    snap = unwrap(await client.session.get({ path: { id: childID } }));
  } catch (err) {
    report.a2.reason = `session.get threw: ${err && err.message ? err.message : String(err)}`;
    report.diagnostics.getError = String(err);
    return report;
  }
  const stateNow = readState(snap);
  const outNow = readOutputTokens(snap);
  // Fire-and-forget: the parent must regain control BEFORE the child finishes.
  // Proven if the child has not yet produced output (tokens.output === 0) at the
  // instant right after the non-awaited prompt call. (If a `state` field exists,
  // `running` is also accepted.)
  report.a2.pass = stateNow === 'running' || outNow === 0;
  report.a2.reason = `state=${stateNow}, outputTokens=${outNow} immediately after non-awaited prompt`;
  report.diagnostics.a2State = stateNow;
  report.diagnostics.a2OutputTokens = outNow;
  report.diagnostics.a2SessionKeys = snap && typeof snap === 'object' ? Object.keys(snap) : null;

  // --- A1: poll until terminal or timeout ---
  const start = Date.now();
  let final = snap;
  let finalState = stateNow;
  while (Date.now() - start < timeoutMs) {
    await sleep(pollMs);
    try {
      final = unwrap(await client.session.get({ path: { id: childID } }));
    } catch {
      // Transient read error — keep polling.
    }
    finalState = readState(final);
    if (finalState === 'completed' || finalState === 'error' || finalState === 'cancelled') break;
    // This API version has no `state` field; detect execution via output tokens.
    if (readOutputTokens(final) > 0) break;
  }
  report.diagnostics.getSession = final;

  const assistantParts = countAssistantParts(final);
  const partsFieldPresent = hasPartsField(final);
  const finalOut = readOutputTokens(final);
  report.diagnostics.finalState = finalState;
  report.diagnostics.finalOutputTokens = finalOut;
  report.diagnostics.assistantParts = assistantParts;
  report.diagnostics.partsFieldPresent = partsFieldPresent;

  const executed = finalState === 'completed' || finalOut > 0;
  if (!executed) {
    report.a1.reason = `child did not execute (finalState=${finalState}, outputTokens=${finalOut}) within ${timeoutMs}ms — matches OpenCode #8528 symptom if create succeeded but the prompt never ran.`;
  } else if (partsFieldPresent && assistantParts === 0) {
    report.a1.reason = `child executed (outputTokens=${finalOut}) but 0 assistant parts detected (parts field present).`;
  } else {
    report.a1.pass = true;
    report.a1.reason = `child executed: outputTokens=${finalOut}, assistantParts=${assistantParts} (partsFieldPresent=${partsFieldPresent}).`;
  }

  // --- Cleanup: abort if still running ---
  if (finalState === 'running') {
    try {
      await client.session.abort({ path: { id: childID } });
      report.diagnostics.aborted = true;
    } catch (err) {
      report.diagnostics.abortError = String(err);
    }
  }

  report.ok = report.a1.pass && report.a2.pass;
  return report;
}

function renderReport(report) {
  const lines = [];
  lines.push('=== Phase 0 spawn probe ===');
  lines.push(`A1 (child executes): ${report.a1.pass ? 'PASS' : 'FAIL'} — ${report.a1.reason}`);
  lines.push(`A2 (fire-and-forget): ${report.a2.pass ? 'PASS' : 'FAIL'} — ${report.a2.reason}`);
  lines.push(`GATE: ${report.ok ? 'PASS' : 'FAIL'}`);
  if (report.diagnostics && Object.keys(report.diagnostics).length) {
    lines.push('--- diagnostics ---');
    for (const [key, value] of Object.entries(report.diagnostics)) {
      lines.push(`${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
    }
  }
  return lines.join('\n');
}

module.exports = { probeSpawn, renderReport };

// CLI guard: this module needs a live ctx.client and cannot run standalone.
if (require.main === module) {
  console.log('probe-spawn.js is DEV-ONLY and requires a live in-process ctx.client.');
  console.log('It cannot be run via bare `node scripts/probe-spawn.js`.');
  console.log('Load plugins/swe-pro-probe.js in opencode and call the `probe_spawn` tool.');
  process.exit(0);
}
