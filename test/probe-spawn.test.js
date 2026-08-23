'use strict';

/**
 * probe-spawn.test.js — plain-node unit test for scripts/probe-spawn.js.
 *
 * Runs probeSpawn against a fake in-process client covering the four outcomes
 * the Phase 0 gate must distinguish. No opencode session required, so this is
 * green in any environment (CI or local).
 */

const assert = require('assert');
const { probeSpawn, renderReport } = require('../scripts/probe-spawn.js');

function makeFakeClient(behavior) {
  const sessions = {};
  let idCounter = 0;

  return {
    session: {
      async create(args) {
        if (behavior === 'createThrows') throw new Error('create failed (simulated)');
        const id = 'child_' + (++idCounter);
        sessions[id] = { id, state: 'registered', parts: [] };
        return { data: sessions[id] };
      },
      async prompt({ path }) {
        const s = sessions[path.id];
        if (!s) return Promise.resolve({ ok: false });

        if (behavior === 'neverCompletes') {
          // #8528 symptom: prompt accepted but child never executes.
          s.state = 'running';
          return new Promise(() => {}); // never resolves
        }
        if (behavior === 'blocksCompleted') {
          // Worst case: prompt synchronously completes the child.
          s.state = 'completed';
          s.parts = [{ type: 'assistant', text: 'PONG' }];
          s.tokens = { output: 5 };
          return Promise.resolve({ ok: true });
        }
        // happy: running now, completed shortly after.
        s.state = 'running';
        setTimeout(() => {
          s.state = 'completed';
          s.parts = [{ type: 'assistant', text: 'PONG' }];
          s.tokens = { output: 5 };
        }, 30);
        return Promise.resolve({ ok: true });
      },
      async get({ path }) {
        return { data: sessions[path.id] };
      },
      async abort({ path }) {
        if (sessions[path.id]) sessions[path.id].state = 'cancelled';
        return { ok: true };
      },
    },
  };
}

async function run() {
  let passed = 0;
  let failed = 0;

  // 1. Happy path: A1 + A2 both pass.
  {
    const ctx = { client: makeFakeClient('happy'), directory: '/tmp' };
    const report = await probeSpawn(ctx, { timeoutMs: 2000 });
    try {
      assert.strictEqual(report.a1.pass, true, 'happy: A1 should pass');
      assert.strictEqual(report.a2.pass, true, 'happy: A2 should pass');
      assert.strictEqual(report.ok, true, 'happy: gate should pass');
      console.log('PASS  happy path (A1+A2)');
      passed += 1;
    } catch (err) {
      console.log('FAIL  happy path:', err.message);
      failed += 1;
    }
  }

  // 2. create throws: A1 fails with reason, gate fails.
  {
    const ctx = { client: makeFakeClient('createThrows'), directory: '/tmp' };
    const report = await probeSpawn(ctx, { timeoutMs: 2000 });
    try {
      assert.strictEqual(report.a1.pass, false, 'createThrows: A1 should fail');
      assert.ok(/threw/.test(report.a1.reason), 'createThrows: reason should mention throw');
      assert.strictEqual(report.ok, false, 'createThrows: gate should fail');
      console.log('PASS  createThrows (A1 fails, gate fails)');
      passed += 1;
    } catch (err) {
      console.log('FAIL  createThrows:', err.message);
      failed += 1;
    }
  }

  // 3. neverCompletes (#8528): A2 passes (running) but A1 fails (timeout).
  {
    const ctx = { client: makeFakeClient('neverCompletes'), directory: '/tmp' };
    const report = await probeSpawn(ctx, { timeoutMs: 300, pollMs: 50 });
    try {
      assert.strictEqual(report.a2.pass, true, 'neverCompletes: A2 should pass (state running)');
      assert.strictEqual(report.a1.pass, false, 'neverCompletes: A1 should fail (no completion)');
      assert.strictEqual(report.ok, false, 'neverCompletes: gate should fail');
      console.log('PASS  neverCompletes (#8528 symptom: A2 ok, A1 fails)');
      passed += 1;
    } catch (err) {
      console.log('FAIL  neverCompletes:', err.message);
      failed += 1;
    }
  }

  // 4. blocksCompleted: A2 fails (state already completed), A1 passes.
  {
    const ctx = { client: makeFakeClient('blocksCompleted'), directory: '/tmp' };
    const report = await probeSpawn(ctx, { timeoutMs: 2000 });
    try {
      assert.strictEqual(report.a2.pass, false, 'blocksCompleted: A2 should fail (not fire-and-forget)');
      assert.strictEqual(report.a1.pass, true, 'blocksCompleted: A1 should pass (completed + parts)');
      assert.strictEqual(report.ok, false, 'blocksCompleted: gate should fail');
      console.log('PASS  blocksCompleted (A2 fails: prompt blocked)');
      passed += 1;
    } catch (err) {
      console.log('FAIL  blocksCompleted:', err.message);
      failed += 1;
    }
  }

  // 5. No ctx.client: graceful failure, not a crash.
  {
    const report = await probeSpawn({}, { timeoutMs: 1000 });
    try {
      assert.strictEqual(report.a1.pass, false, 'no-client: A1 should fail');
      assert.ok(/ctx.client/.test(report.a1.reason), 'no-client: reason should mention ctx.client');
      console.log('PASS  no-client guard (graceful)');
      passed += 1;
    } catch (err) {
      console.log('FAIL  no-client guard:', err.message);
      failed += 1;
    }
  }

  // renderReport sanity
  {
    const ctx = { client: makeFakeClient('happy'), directory: '/tmp' };
    const report = await probeSpawn(ctx, { timeoutMs: 2000 });
    const text = renderReport(report);
    try {
      assert.ok(/GATE: PASS/.test(text), 'renderReport should show GATE: PASS');
      console.log('PASS  renderReport format');
      passed += 1;
    } catch (err) {
      console.log('FAIL  renderReport format:', err.message);
      failed += 1;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
