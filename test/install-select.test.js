#!/usr/bin/env node

/**
 * Unit tests for scripts/install-select.js (component selection UX).
 *
 * Pure-function coverage, no TTY needed: parsePick answers, resolveSelection
 * flag/env values, option-listing shape, and the shouldPrompt safety gate.
 * Interactive prompting itself is exercised manually, not here.
 *
 * Zero dependencies: node:assert + node:fs + node:os + node:path.
 * Run with: node test/install-select.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const select = require('../scripts/install-select.js');

const REPO = path.resolve(__dirname, '..');

let passed = 0;
let failed = 0;

/** Run one test; prints the outcome and records pass/fail totals. */
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

function indexesOf(parsed) {
  return [...parsed.indexes].sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// parsePick
// ---------------------------------------------------------------------------

test('parsePick empty/all selects everything', () => {
  for (const input of ['', 'all', 'ALL', '  ']) {
    const parsed = select.parsePick(input, 4);
    assert.strictEqual(parsed.ok, true, input);
    assert.deepStrictEqual(indexesOf(parsed), [0, 1, 2, 3]);
  }
});

test('parsePick none selects nothing', () => {
  const parsed = select.parsePick('none', 4);
  assert.strictEqual(parsed.ok, true);
  assert.deepStrictEqual(indexesOf(parsed), []);
});

test('parsePick numbers and ranges (1-based)', () => {
  assert.deepStrictEqual(indexesOf(select.parsePick('1,3', 5)), [0, 2]);
  assert.deepStrictEqual(indexesOf(select.parsePick('2-4', 5)), [1, 2, 3]);
  assert.deepStrictEqual(indexesOf(select.parsePick('1, 3-4, 5', 5)), [0, 2, 3, 4]);
  assert.deepStrictEqual(indexesOf(select.parsePick('2 4', 5)), [1, 3]);
});

test('parsePick exclusions subtract from everything', () => {
  assert.deepStrictEqual(indexesOf(select.parsePick('-2', 4)), [0, 2, 3]);
  assert.deepStrictEqual(indexesOf(select.parsePick('all,-1,-4', 4)), [1, 2]);
  assert.deepStrictEqual(indexesOf(select.parsePick('1-4,-2', 4)), [0, 2, 3]);
});

test('parsePick rejects garbage and out-of-range input', () => {
  for (const input of ['foo', '0', '9', '3-2', '2-99', '1.5', '--select']) {
    const parsed = select.parsePick(input, 5);
    assert.strictEqual(parsed.ok, false, input);
    assert.ok(typeof parsed.error === 'string' && parsed.error.length > 0, 'error message');
  }
});

// ---------------------------------------------------------------------------
// resolveSelection
// ---------------------------------------------------------------------------

const PACK = { agents: ['a.md', 'b.md'], skills: ['x', 'y'] };

test('resolveSelection leaves everything null with no opinions', () => {
  assert.deepStrictEqual(select.resolveSelection({}, PACK), {
    agents: null,
    skills: null,
    background: null,
    goal: null,
  });
});

test('resolveSelection all/none/csv names', () => {
  assert.deepStrictEqual(select.resolveSelection({ agents: 'all' }, PACK).agents, ['a.md', 'b.md']);
  assert.deepStrictEqual(select.resolveSelection({ skills: 'none' }, PACK).skills, []);
  assert.deepStrictEqual(select.resolveSelection({ agents: 'b.md,a.md,b.md' }, PACK).agents, ['b.md', 'a.md']);
});

test('resolveSelection throws on unknown names', () => {
  assert.throws(() => select.resolveSelection({ skills: 'x,nope' }, PACK), /unknown skills: nope/);
  assert.throws(() => select.resolveSelection({ agents: 'ghost.md' }, PACK), /unknown agents/);
});

test('resolveSelection parses flag values', () => {
  assert.strictEqual(select.resolveSelection({ background: true }, PACK).background, true);
  assert.strictEqual(select.resolveSelection({ goal: 'false' }, PACK).goal, false);
  assert.strictEqual(select.resolveSelection({ goal: '0' }, PACK).goal, false);
  assert.strictEqual(select.resolveSelection({ background: 'yes' }, PACK).background, true);
  assert.throws(() => select.resolveSelection({ goal: 'sometimes' }, PACK), /want true\/false/);
});

// ---------------------------------------------------------------------------
// Option listing
// ---------------------------------------------------------------------------

test('listAgentOptions mirrors the agents dir with descriptions', () => {
  const options = select.listAgentOptions();
  const files = fs.readdirSync(path.join(REPO, 'agents')).filter((f) => f.endsWith('.md')).sort();
  assert.deepStrictEqual(options.map((o) => o.file), files);
  for (const o of options) {
    assert.strictEqual(o.kind, 'agent');
    assert.strictEqual(o.name, path.basename(o.file, '.md'));
    assert.ok(typeof o.description === 'string' && o.description.length > 0, `${o.name} has a description`);
  }
});

test('listSkillOptions mirrors skill dirs with SKILL.md', () => {
  const options = select.listSkillOptions();
  const dirs = fs
    .readdirSync(path.join(REPO, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(REPO, 'skills', e.name, 'SKILL.md')))
    .map((e) => e.name)
    .sort();
  assert.deepStrictEqual(options.map((o) => o.name), dirs);
  for (const o of options) {
    assert.strictEqual(o.kind, 'skill');
    assert.ok(typeof o.description === 'string' && o.description.length > 0, `${o.name} has a description`);
  }
});

test('listSystemOptions offers background and goal', () => {
  assert.deepStrictEqual(select.listSystemOptions().map((o) => o.id), ['background', 'goal']);
});

// ---------------------------------------------------------------------------
// shouldPrompt gate (never blocks CI / non-TTY / silenced runs)
// ---------------------------------------------------------------------------

function withEnv(patch, fn) {
  const saved = {};
  for (const key of Object.keys(patch)) {
    saved[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

test('shouldPrompt false when silenced or CI', () => {
  withEnv({ SWE_PRO_AGENTS_NO_PROMPT: '1' }, () => {
    assert.strictEqual(select.shouldPrompt(), false);
  });
  withEnv({ SWE_PRO_AGENTS_NO_PROMPT: undefined, CI: 'true' }, () => {
    assert.strictEqual(select.shouldPrompt(), false);
  });
});

test('shouldPrompt follows TTY otherwise', () => {
  withEnv({ SWE_PRO_AGENTS_NO_PROMPT: undefined, CI: undefined }, () => {
    assert.strictEqual(select.shouldPrompt(), !!process.stdin.isTTY);
  });
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
