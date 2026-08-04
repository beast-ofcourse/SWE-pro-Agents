#!/usr/bin/env node

/**
 * Self-tests for scripts/validate.js.
 *
 * Proves the validator itself works by running it against fixture files:
 * a valid agent, a broken agent, a valid skill, a broken skill — plus unit
 * checks for the frontmatter parser and task-ref parser.
 *
 * Zero dependencies: node:assert + node:fs + node:os + node:path.
 * Run with: node test/validate.test.js
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  slugify,
  parseFrontmatter,
  parseTaskRefs,
  validateAgentFile,
  validateSkillDir,
} = require('../scripts/validate.js');

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

/** Write a file into a throwaway temp dir and return its path. */
function fixture(content, relPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
  const full = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

const KNOWN_SUBAGENTS = new Set(['swe-api', 'swe-database', 'swe-frontend']);

const VALID_AGENT = `---
description: A valid agent for testing.
mode: subagent
permission:
  task:
    '*': deny
    swe-api: allow
    general: allow
---
# Valid Agent
`;

const BROKEN_AGENT = `---
description: |
  This description is folded across multiple lines, which violates the
  single-line requirement for agents.
mode: primary
permission:
  task:
    '*': deny
    typo-agent: allow
---
# Broken Agent
`;

const VALID_SKILL = `---
name: my-skill
description: "Use when the user asks for a thing."
license: MIT
compatibility: opencode
---
# My Skill
`;

const BROKEN_SKILL = `---
name: My_Skill
description: "A prose description with no trigger language at all."
license: Apache-2.0
---
# Broken Skill
`;

// ---------------------------------------------------------------------------
// Unit: slugify
// ---------------------------------------------------------------------------
test('slugify lowercases and collapses non-alphanumerics to hyphens', () => {
  assert.strictEqual(slugify('SWE Pro'), 'swe-pro');
  assert.strictEqual(slugify('Arch Design'), 'arch-design');
  assert.strictEqual(slugify('  PR   Reviewer  '), 'pr-reviewer');
});

// ---------------------------------------------------------------------------
// Unit: parseFrontmatter
// ---------------------------------------------------------------------------
test('parseFrontmatter reads simple keys and quoted values', () => {
  const fm = parseFrontmatter('---\ndescription: "hello world"\nmode: primary\n---\n# body');
  assert.strictEqual(fm.ok, true);
  assert.strictEqual(fm.data.description, 'hello world');
  assert.strictEqual(fm.data.mode, 'primary');
});

test('parseFrontmatter folds block scalars into a single line', () => {
  const fm = parseFrontmatter('---\ndescription: >\n  line one\n  line two\nlicense: MIT\n---\n');
  assert.strictEqual(fm.ok, true);
  assert.strictEqual(fm.data.description, 'line one line two');
  assert.strictEqual(fm.data.license, 'MIT');
});

test('parseFrontmatter rejects missing or unbalanced delimiters', () => {
  assert.strictEqual(parseFrontmatter('# no frontmatter').ok, false);
  assert.strictEqual(parseFrontmatter('---\ndescription: x\n').ok, false);
});

// ---------------------------------------------------------------------------
// Unit: parseTaskRefs
// ---------------------------------------------------------------------------
test('parseTaskRefs extracts allow/deny names including wildcards', () => {
  const refs = parseTaskRefs([
    "permission:",
    "  task:",
    "    '*': deny",
    "    swe-*: allow",
    "    general: allow",
  ]);
  assert.deepStrictEqual(refs, [
    { name: '*', action: 'deny' },
    { name: 'swe-*', action: 'allow' },
    { name: 'general', action: 'allow' },
  ]);
});

// ---------------------------------------------------------------------------
// validateAgentFile
// ---------------------------------------------------------------------------
test('valid agent passes', () => {
  const v = validateAgentFile(fixture(VALID_AGENT, 'valid-agent.md'), KNOWN_SUBAGENTS);
  assert.deepStrictEqual(v, []);
});

test('broken agent is flagged for folded description, wrong mode, unknown task ref', () => {
  const v = validateAgentFile(fixture(BROKEN_AGENT, 'broken-agent.md'), KNOWN_SUBAGENTS);
  const rules = v.map((x) => x.rule);
  assert.ok(rules.includes('A2'), 'folded description flagged (A2)');
  assert.ok(rules.includes('A5'), 'subagent declaring primary flagged (A5)');
  assert.ok(rules.includes('A6'), 'unknown task ref flagged (A6)');
});

test('agent missing frontmatter is flagged (A1)', () => {
  const v = validateAgentFile(fixture('# No Frontmatter\n', 'no-fm.md'), KNOWN_SUBAGENTS);
  assert.ok(v.some((x) => x.rule === 'A1'));
});

// ---------------------------------------------------------------------------
// validateSkillDir
// ---------------------------------------------------------------------------
test('valid skill passes', () => {
  const v = validateSkillDir(path.dirname(fixture(VALID_SKILL, 'my-skill/SKILL.md')));
  assert.deepStrictEqual(v, []);
});

test('broken skill is flagged for name, license, compatibility, trigger language', () => {
  const v = validateSkillDir(path.dirname(fixture(BROKEN_SKILL, 'broken-skill/SKILL.md')));
  const rules = v.map((x) => x.rule);
  assert.ok(rules.includes('S3'), 'invalid name flagged (S3)');
  assert.ok(rules.includes('S5'), 'non-MIT license flagged (S5)');
  assert.ok(rules.includes('S6'), 'missing compatibility flagged (S6)');
  assert.ok(rules.includes('S8'), 'missing trigger language flagged (S8)');
});

test('skill dir missing SKILL.md is flagged (S1)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-test-'));
  const v = validateSkillDir(dir);
  assert.ok(v.some((x) => x.rule === 'S1'));
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);