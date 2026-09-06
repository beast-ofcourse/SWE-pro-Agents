'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createJournal } = require('../scripts/background-journal.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bg-journal-test-'));
}

function backdateNewest(store, id, ageMs) {
  const file = path.join(store, id + '.journal.jsonl');
  const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
  const events = lines.map((line) => JSON.parse(line));
  events[events.length - 1].t = Date.now() - ageMs;
  fs.writeFileSync(file, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
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

  await check('append adds lines, replay returns events in order', async () => {
    const journal = createJournal({ storeDir: tmpDir() });
    journal.append('a', 'registered', { n: 1 });
    journal.append('a', 'running', { n: 2 });
    const events = journal.replay('a');
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].type, 'registered');
    assert.strictEqual(events[1].type, 'running');
    assert.deepStrictEqual(events[0].payload, { n: 1 });
    assert.deepStrictEqual(events[1].payload, { n: 2 });
    assert.ok(typeof events[0].t === 'number');
  });

  await check('replay missing file returns empty array', async () => {
    const journal = createJournal({ storeDir: tmpDir() });
    assert.deepStrictEqual(journal.replay('nope'), []);
  });

  await check('prune missing file no-ops', async () => {
    const journal = createJournal({ storeDir: tmpDir() });
    journal.prune('nope', 1000, true);
    journal.prune('nope', 1000, false);
  });

  await check('prune terminal old deletes journal', async () => {
    const store = tmpDir();
    const journal = createJournal({ storeDir: store });
    journal.append('old', 'registered', {});
    journal.append('old', 'completed', {});
    backdateNewest(store, 'old', 10 * 24 * 60 * 60 * 1000);
    journal.prune('old', 7 * 24 * 60 * 60 * 1000, true);
    assert.ok(!fs.existsSync(path.join(store, 'old.journal.jsonl')));
    assert.deepStrictEqual(journal.replay('old'), []);
  });

  await check('prune nonterminal keeps old journal', async () => {
    const store = tmpDir();
    const journal = createJournal({ storeDir: store });
    journal.append('run', 'registered', {});
    journal.append('run', 'running', {});
    backdateNewest(store, 'run', 10 * 24 * 60 * 60 * 1000);
    journal.prune('run', 7 * 24 * 60 * 60 * 1000, false);
    assert.ok(fs.existsSync(path.join(store, 'run.journal.jsonl')));
    assert.strictEqual(journal.replay('run').length, 2);
  });

  await check('prune recent terminal keeps journal', async () => {
    const store = tmpDir();
    const journal = createJournal({ storeDir: store });
    journal.append('fresh', 'registered', {});
    journal.append('fresh', 'completed', {});
    journal.prune('fresh', 7 * 24 * 60 * 60 * 1000, true);
    assert.ok(fs.existsSync(path.join(store, 'fresh.journal.jsonl')));
    assert.strictEqual(journal.replay('fresh').length, 2);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
