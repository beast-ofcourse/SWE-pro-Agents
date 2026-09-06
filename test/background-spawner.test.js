'use strict';

const assert = require('assert');
const { createSessionSpawner, createNativeSpawnerStub } = require('../scripts/background-spawner.js');

function immediateClient() {
  return {
    session: {
      async create() {
        return { data: { id: 'child-now' } };
      },
      async prompt() {
        return { ok: true };
      },
      async get() {
        return { data: { id: 'child-now', state: 'running', updatedAt: 1700000000000 } };
      },
    },
  };
}

function delayedClient() {
  let calls = 0;
  return {
    session: {
      async create() {
        return { data: { id: 'child-delayed' } };
      },
      async prompt() {
        return { ok: true };
      },
      async get() {
        calls += 1;
        if (calls < 3) throw new Error('not found yet');
        return { data: { id: 'child-delayed', state: 'running', updatedAt: 777 } };
      },
    },
  };
}

function activityClient(session) {
  return {
    session: {
      async create() {
        return { data: { id: 'child-activity' } };
      },
      async prompt() {
        return { ok: true };
      },
      async get() {
        return { data: session };
      },
    },
  };
}

function goneClient() {
  return {
    session: {
      async create() {
        return { data: { id: 'child-gone' } };
      },
      async prompt() {
        return { ok: true };
      },
      async get() {
        throw new Error('no such session');
      },
    },
  };
}

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

  await check('spawn returns childSessionID with sessionStarted true immediately', async () => {
    const spawner = createSessionSpawner({ client: immediateClient() });
    const out = await spawner.spawn({ prompt: 'hello', title: 'immediate' });
    assert.strictEqual(out.childSessionID, 'child-now', 'childSessionID should match created id');
    assert.strictEqual(out.sessionStarted, true, 'sessionStarted should be true immediately');
  });

  await check('spawn polls until delayed session appears with sessionStarted true', async () => {
    const spawner = createSessionSpawner({ client: delayedClient() });
    const out = await spawner.spawn({ prompt: 'hello', title: 'delayed', waitForSessionStartMs: 4000 });
    assert.strictEqual(out.childSessionID, 'child-delayed', 'childSessionID should match created id');
    assert.strictEqual(out.sessionStarted, true, 'sessionStarted should become true after the wait loop');
  });

  await check('getActivity resolves lastActivityAt by priority', async () => {
    const spawner = createSessionSpawner({ client: activityClient({ id: 's', state: 'running', tokens: { input: 1, output: 2 }, updatedAt: 100, lastActivityAt: 200, activityAt: 300, lastMessageAt: 400 }) });
    const activity = await spawner.getActivity('s');
    assert.strictEqual(activity.state, 'running', 'state should pass through');
    assert.deepStrictEqual(activity.tokens, { input: 1, output: 2 }, 'tokens should pass through');
    assert.strictEqual(activity.lastActivityAt, 100, 'updatedAt should win priority');
    const fallback = createSessionSpawner({ client: activityClient({ id: 's', state: 'running', activityAt: 300, lastMessageAt: 400 }) });
    const fallbackActivity = await fallback.getActivity('s');
    assert.strictEqual(fallbackActivity.lastActivityAt, 300, 'activityAt should win when earlier fields absent');
  });

  await check('getActivity returns null when activity fields absent and gone on throw', async () => {
    const spawner = createSessionSpawner({ client: activityClient({ id: 's', state: 'running' }) });
    const activity = await spawner.getActivity('s');
    assert.strictEqual(activity.lastActivityAt, null, 'lastActivityAt should be null when fields absent');
    const gone = createSessionSpawner({ client: goneClient() });
    const missing = await gone.getActivity('missing');
    assert.strictEqual(missing.state, 'gone', 'state should be gone on throw');
    assert.strictEqual(missing.lastActivityAt, null, 'lastActivityAt should be null when gone');
  });

  await check('NativeSpawnerStub spawn and getActivity throw not-implemented', async () => {
    const stub = createNativeSpawnerStub();
    let spawnThrew = false;
    try {
      await stub.spawn({});
    } catch (err) {
      spawnThrew = true;
      assert.strictEqual(err.message, 'NativeSpawner not implemented in v1', 'spawn error message should match');
    }
    assert.ok(spawnThrew, 'spawn should throw');
    let activityThrew = false;
    try {
      await stub.getActivity('anything');
    } catch (err) {
      activityThrew = true;
      assert.strictEqual(err.message, 'NativeSpawner not implemented in v1', 'getActivity error message should match');
    }
    assert.ok(activityThrew, 'getActivity should throw');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
