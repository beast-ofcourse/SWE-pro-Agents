'use strict';

/**
 * background-scheduler.test.js — plain-node tests for scripts/background-scheduler.js.
 * Covers the T-021 Verify cases: per-key limit, global cap, fair-share reject
 * at 0.75, release frees slot, plus keyFor computation (incl. null model/provider).
 */

const assert = require('assert');
const { createScheduler, keyFor } = require('../scripts/background-scheduler.js');

async function run() {
  let passed = 0;
  let failed = 0;

  function check(name, fn) {
    return fn()
      .then(() => {
        console.log('PASS  ' + name);
        passed += 1;
      })
      .catch((err) => {
        console.log('FAIL  ' + name + ': ' + err.message);
        failed += 1;
      });
  }

  await check('keyFor computes provider/model, provider, default', async () => {
    assert.strictEqual(keyFor({ model: 'openai/gpt-4', provider: 'openai' }), 'openai/gpt-4', 'slashed model used as-is');
    assert.strictEqual(keyFor({ model: 'gpt-4', provider: 'openai' }), 'openai/gpt-4', 'unslashed model prefixed with provider');
    assert.strictEqual(keyFor({ model: 'gpt-4' }), 'gpt-4', 'model without provider is its own key');
    assert.strictEqual(keyFor({ provider: 'openai' }), 'openai', 'provider-only falls back to provider');
    assert.strictEqual(keyFor({}), 'default', 'neither falls back to default');
    assert.strictEqual(keyFor({ model: null, provider: null }), 'default', 'null model/provider (T-004 shape) falls back to default');
    assert.strictEqual(keyFor(null), 'default', 'null delegation falls back to default');
  });

  await check('per-key limit queues the 6th same-model task by default', async () => {
    const scheduler = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '10' } });
    for (let i = 0; i < 5; i += 1) {
      const admission = scheduler.acquire('openai/gpt-4', 'parent-' + i);
      assert.strictEqual(admission.ok, true, 'first 5 same-model acquires succeed (i=' + i + ')');
    }
    const blocked = scheduler.acquire('openai/gpt-4', 'parent-other');
    assert.strictEqual(blocked.ok, false, '6th same-model acquire must block');
    assert.strictEqual(blocked.reason, 'per_key', 'block reason must be per_key');
    const otherKey = scheduler.acquire('other/model', 'parent-other');
    assert.strictEqual(otherKey.ok, true, 'a different key must still admit');
  });

  await check('global cap respected across keys', async () => {
    const scheduler = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '2' } });
    assert.strictEqual(scheduler.acquire('key-a', 'pa').ok, true, 'first global slot admits');
    assert.strictEqual(scheduler.acquire('key-b', 'pb').ok, true, 'second global slot admits');
    const blocked = scheduler.acquire('key-c', 'pc');
    assert.strictEqual(blocked.ok, false, 'third acquire past global cap must block');
    assert.strictEqual(blocked.reason, 'global', 'block reason must be global');
  });

  await check('fair-share rejects one parent past ceil(maxParallel * 0.75)', async () => {
    const scheduler = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '4' } });
    for (let i = 0; i < 3; i += 1) {
      const admission = scheduler.acquire('default', 'greedy-parent');
      assert.strictEqual(admission.ok, true, 'greedy parent holds 3 slots (i=' + i + ')');
    }
    const blocked = scheduler.acquire('default', 'greedy-parent');
    assert.strictEqual(blocked.ok, false, 'greedy parent 4th acquire must block');
    assert.strictEqual(blocked.reason, 'fair_share', 'block reason must be fair_share');
    const otherParent = scheduler.acquire('default', 'other-parent');
    assert.strictEqual(otherParent.ok, true, 'headroom slot stays free for another parent');
  });

  await check('release frees the slot for re-acquire', async () => {
    const scheduler = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '1' } });
    assert.strictEqual(scheduler.acquire('default', 'p1').ok, true, 'single slot admits');
    assert.strictEqual(scheduler.acquire('default', 'p2').ok, false, 'capped slot blocks');
    const freed = scheduler.release('default', 'p1');
    assert.strictEqual(freed.ok, true, 'release reports the freed slot');
    assert.strictEqual(scheduler.acquire('default', 'p2').ok, true, 'slot admits again after release');
    assert.deepStrictEqual(scheduler.keys(), ['default'], 'keys lists the active key');
    scheduler.release('default', 'p2');
    assert.deepStrictEqual(scheduler.keys(), [], 'keys empties after all releases');
    const missing = scheduler.release('default', 'p2');
    assert.strictEqual(missing.ok, false, 'releasing an unheld slot is a safe no-op');
  });

  await check('backoff set on 429, cleared after window', async () => {
    const scheduler = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '10', SWE_PRO_BG_BACKOFF_BASE: '20', SWE_PRO_BG_BACKOFF_MAX: '50' } });
    scheduler.noteError('openai/gpt-4', new Error('429 Too Many Requests'));
    const blocked = scheduler.acquire('openai/gpt-4', 'p1');
    assert.strictEqual(blocked.ok, false, 'backed-off key must block');
    assert.strictEqual(blocked.reason, 'backoff', 'block reason must be backoff');
    const otherKey = scheduler.acquire('other/model', 'p1');
    assert.strictEqual(otherKey.ok, true, 'a different key must still admit while one key backs off');
    await new Promise((r) => setTimeout(r, 70));
    const admitted = scheduler.acquire('openai/gpt-4', 'p1');
    assert.strictEqual(admitted.ok, true, 'key must admit again after the backoff window');
  });

  await check('budget blocks over threshold', async () => {
    const scheduler = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '10', SWE_PRO_BG_TOKEN_BUDGET: '100' } });
    assert.strictEqual(scheduler.acquire('default', 'p1').ok, true, 'first slot admits before budget fills');
    scheduler.noteTokens('default', 60);
    scheduler.noteTokens('default', 51);
    const blocked = scheduler.acquire('default', 'p2');
    assert.strictEqual(blocked.ok, false, 'over-budget key must block');
    assert.strictEqual(blocked.reason, 'budget', 'block reason must be budget');
    scheduler.release('default', 'p1');
    const admitted = scheduler.acquire('default', 'p2');
    assert.strictEqual(admitted.ok, true, 'soft budget resets when the key drains via release');
  });

  await check('circuit opens after threshold and half-closes on success', async () => {
    const scheduler = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '10', SWE_PRO_BG_CB_THRESHOLD: '3' } });
    scheduler.noteSpawnFailure('k');
    scheduler.noteSpawnFailure('k');
    assert.strictEqual(scheduler.acquire('k', 'p1').ok, true, 'below threshold still admits');
    scheduler.release('k', 'p1');
    scheduler.noteSpawnFailure('k');
    // Open: the first acquire is the single half-open trial (admitted); the
    // next concurrent acquire must refuse with circuit_open (a closed circuit
    // would admit both under the cap of 10).
    const trial = scheduler.acquire('k', 'p2');
    assert.strictEqual(trial.ok, true, 'half-close allows exactly one trial acquire');
    const blocked = scheduler.acquire('k', 'p3');
    assert.strictEqual(blocked.ok, false, 'second acquire during the trial must block');
    assert.strictEqual(blocked.reason, 'circuit_open', 'trial block reason must be circuit_open');
    assert.strictEqual(scheduler.acquire('other', 'p4').ok, true, 'other keys still admit while one key is open');
    // Trial success fully closes + resets counters.
    scheduler.noteSpawnSuccess('k');
    scheduler.release('k', 'p2');
    scheduler.release('other', 'p4');
    assert.strictEqual(scheduler.acquire('k', 'p5').ok, true, 'trial success fully closes the circuit');
    scheduler.release('k', 'p5');
    scheduler.noteSpawnFailure('k');
    scheduler.noteSpawnFailure('k');
    assert.strictEqual(scheduler.acquire('k', 'p6').ok, true, 'reset counters tolerate threshold-1 fresh failures');
    scheduler.release('k', 'p6');
    // Default threshold is 5.
    const def = createScheduler({ env: { SWE_PRO_BG_MAX_PARALLEL: '10' } });
    for (let i = 0; i < 4; i += 1) def.noteSpawnFailure('k');
    assert.strictEqual(def.acquire('k', 'p').ok, true, 'default threshold 5: 4 failures still admit');
    def.release('k', 'p');
    def.noteSpawnFailure('k');
    assert.strictEqual(def.acquire('k', 'p').ok, true, 'default threshold 5: 5th failure opens (trial admitted)');
    const defBlocked = def.acquire('k', 'p2');
    assert.strictEqual(defBlocked.ok, false, 'open circuit refuses concurrent acquires');
    assert.strictEqual(defBlocked.reason, 'circuit_open', 'default block reason must be circuit_open');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
