'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const config = require('../scripts/pack-config.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}\n  ${err.message}`);
  }
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('defaultConfig returns goal enabled', () => {
  const c = config.defaultConfig();
  assert.deepStrictEqual(c, { features: { goal: true } });
});

test('configPath joins config file name', () => {
  assert.strictEqual(config.configPath('/tmp/proj'), path.join('/tmp/proj', config.CONFIG_FILE));
});

test('configPath returns null for missing directory', () => {
  assert.strictEqual(config.configPath(undefined), null);
  assert.strictEqual(config.configPath(''), null);
});

test('loadConfig returns default when file missing', () => {
  const dir = tempDir('cfg-missing-');
  assert.deepStrictEqual(config.loadConfig(dir), config.defaultConfig());
});

test('loadConfig returns default when file corrupt', () => {
  const dir = tempDir('cfg-corrupt-');
  fs.writeFileSync(path.join(dir, config.CONFIG_FILE), '{ not json', 'utf8');
  assert.deepStrictEqual(config.loadConfig(dir), config.defaultConfig());
});

test('loadConfig returns default when features absent', () => {
  const dir = tempDir('cfg-nofeat-');
  fs.writeFileSync(path.join(dir, config.CONFIG_FILE), JSON.stringify({}), 'utf8');
  assert.deepStrictEqual(config.loadConfig(dir), config.defaultConfig());
});

test('loadConfig returns default when features not an object', () => {
  const dir = tempDir('cfg-badfeat-');
  fs.writeFileSync(path.join(dir, config.CONFIG_FILE), JSON.stringify({ features: 'yes' }), 'utf8');
  assert.deepStrictEqual(config.loadConfig(dir), config.defaultConfig());
});

test('isGoalEnabled true when features.goal true', () => {
  const dir = tempDir('cfg-on-');
  fs.writeFileSync(path.join(dir, config.CONFIG_FILE), JSON.stringify({ features: { goal: true } }), 'utf8');
  assert.strictEqual(config.isGoalEnabled(dir), true);
});

test('isGoalEnabled false when features.goal false', () => {
  const dir = tempDir('cfg-off-');
  fs.writeFileSync(path.join(dir, config.CONFIG_FILE), JSON.stringify({ features: { goal: false } }), 'utf8');
  assert.strictEqual(config.isGoalEnabled(dir), false);
});

test('isGoalEnabled true when file missing (fail-open)', () => {
  const dir = tempDir('cfg-failopen-');
  assert.strictEqual(config.isGoalEnabled(dir), true);
});

test('isGoalEnabled true for undefined directory (no throw)', () => {
  assert.strictEqual(config.isGoalEnabled(undefined), true);
});

test('writeConfig creates the file with features.goal', () => {
  const dir = tempDir('cfg-write-');
  config.writeConfig(dir, { goal: false });
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, config.CONFIG_FILE), 'utf8'));
  assert.strictEqual(parsed.features.goal, false);
});

test('writeConfig merges and preserves other keys', () => {
  const dir = tempDir('cfg-merge-');
  fs.writeFileSync(path.join(dir, config.CONFIG_FILE), JSON.stringify({ otherKey: 'keep', features: { goal: true } }), 'utf8');
  config.writeConfig(dir, { goal: false });
  const parsed = JSON.parse(fs.readFileSync(path.join(dir, config.CONFIG_FILE), 'utf8'));
  assert.strictEqual(parsed.features.goal, false);
  assert.strictEqual(parsed.otherKey, 'keep');
});

test('writeConfig is atomic (tmp renamed over target)', () => {
  const dir = tempDir('cfg-atomic-');
  config.writeConfig(dir, { goal: true });
  assert.strictEqual(fs.existsSync(path.join(dir, config.CONFIG_FILE + '.tmp')), false, 'temp file should be renamed away');
});

if (failed > 0) {
  console.error(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`\n${passed} passed, ${failed} failed`);
