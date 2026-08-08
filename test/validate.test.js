#!/usr/bin/env node

/**
 * Self-tests for scripts/validate.js.
 *
 * Proves the validator itself works by running it against fixture files:
 * a valid agent, a broken agent, a valid skill, a broken skill — plus unit
 * checks for the frontmatter parser, task-ref parser, and the pack-level
 * validatePack() rules (C1 counts, A4/A5 primary set, A8/S7 duplicates).
 *
 * Zero dependencies: node:assert + node:child_process + node:fs + node:os + node:path.
 * Run with: node test/validate.test.js
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  slugify,
  parseFrontmatter,
  parseTaskRefs,
  validateAgentFile,
  validateSkillDir,
  validatePack,
  isValidTaskRef,
} = require('../scripts/validate.js');

let passed = 0;
let failed = 0;

/** Temp dirs created during this run, removed at process exit. */
const tempDirs = [];

// Sync-only in the handler, so it also runs when tests fail (process.exit(1)).
process.on('exit', () => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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

/** Create a tracked throwaway dir (removed at process exit). */
function tempDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Write a file into a tracked throwaway temp dir and return its path. */
function fixture(content, relPath) {
  const dir = tempDir('validate-test-');
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

test('parseTaskRefs stops at a sibling key after the task block (regression)', () => {
  // A permission key placed after `task:` at the same indent must NOT be
  // swallowed as a task ref (would otherwise fail A6 with a bogus name).
  const refs = parseTaskRefs([
    "permission:",
    "  edit: deny",
    "  task:",
    "    '*': deny",
    "  webfetch: allow",
    "  websearch: allow",
  ]);
  assert.deepStrictEqual(refs, [{ name: '*', action: 'deny' }]);
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
  const dir = tempDir('validate-test-');
  const v = validateSkillDir(dir);
  assert.ok(v.some((x) => x.rule === 'S1'));
});

// ---------------------------------------------------------------------------
// validatePack (pack-level rules: C1, A4/A5, A8/S7)
// ---------------------------------------------------------------------------

const PRIMARY_NAMES = ['swe-pro', 'architect', 'swe-reviewer', 'pr-reviewer'];

/**
 * Build a throwaway pack directory with `agentCount` agents and `skillCount`
 * skills. Optional corruption flags:
 *  - extraPrimary:   adds a 27th agent that declares mode: primary (A4/A5)
 *  - dupAgentName:   one subagent declares the same frontmatter name as another (A8)
 *  - dupSkillName:   one skill declares the same name as another (S7)
 * Returns the pack root path (tracked for cleanup).
 */
function buildPack({ agentCount = 26, skillCount = 23, extraPrimary = false, dupAgentName = false, dupSkillName = false } = {}) {
  const dir = tempDir('validate-pack-');
  const agentsDir = path.join(dir, 'agents');
  const skillsDir = path.join(dir, 'skills');
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  // A rogue agent that declares mode: primary but is not one of the four primaries.
  const rogueName = extraPrimary ? 'rogue-primary' : null;

  const subagentCount = agentCount - PRIMARY_NAMES.length;
  const agentNames = [];
  for (let i = 1; i <= subagentCount; i++) {
    agentNames.push(`agent-${String(i).padStart(2, '0')}`);
  }
  if (rogueName) agentNames.push(rogueName);

  // Duplicate the FIRST subagent's name onto the SECOND subagent (agent-02),
  // so the duplicate is real (agent-02 declares agent-01's name).
  const dupTarget = dupAgentName && agentNames.length >= 2 ? agentNames[1] : null;

  for (const name of [...PRIMARY_NAMES, ...agentNames]) {
    const mode = PRIMARY_NAMES.includes(name) || name === rogueName ? 'primary' : 'subagent';
    const nameLine = name === dupTarget ? 'name: agent-01\n' : '';
    const content = `---\ndescription: "A valid agent for testing."\nmode: ${mode}\n${nameLine}---\n# ${name}\n`;
    fs.writeFileSync(path.join(agentsDir, `${name}.md`), content);
  }

  // Duplicate the FIRST skill's name onto the SECOND skill (skill-02).
  const dupSkillTarget = dupSkillName && skillCount >= 2 ? 'skill-02' : null;
  for (let i = 1; i <= skillCount; i++) {
    const skillDir = path.join(skillsDir, `skill-${String(i).padStart(2, '0')}`);
    fs.mkdirSync(skillDir, { recursive: true });
    const declaredName = path.basename(skillDir) === dupSkillTarget ? 'skill-01' : path.basename(skillDir);
    const content = `---\nname: ${declaredName}\ndescription: "Use when the user asks for a thing."\nlicense: MIT\ncompatibility: opencode\n---\n# ${path.basename(skillDir)}\n`;
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), content);
  }

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'fixture-pack', version: '0.0.0', description: `${agentCount} OpenCode agent profiles + ${skillCount} skills` })
  );
  fs.writeFileSync(path.join(dir, 'README.md'), `# Fixture\n\n${agentCount} agents, ${skillCount} skills.\n`);

  return dir;
}

test('validatePack passes a healthy 26-agent / 23-skill pack with zero violations', () => {
  const { violations } = validatePack(buildPack());
  assert.deepStrictEqual(violations, []);
});

test('validatePack flags a wrong agent count (C1)', () => {
  const { violations } = validatePack(buildPack({ agentCount: 25 }));
  assert.ok(violations.some((x) => x.rule === 'C1'), 'expected a C1 violation');
});

test('validatePack flags a subagent declaring mode: primary (A4/A5)', () => {
  const { violations } = validatePack(buildPack({ extraPrimary: true }));
  assert.ok(violations.some((x) => x.rule === 'A5'), 'expected an A5 violation');
});

test('validatePack flags duplicate agent names (A8)', () => {
  const { violations } = validatePack(buildPack({ dupAgentName: true }));
  assert.ok(violations.some((x) => x.rule === 'A8'), 'expected an A8 violation');
});

test('validatePack flags duplicate skill names (S7)', () => {
  const { violations } = validatePack(buildPack({ dupSkillName: true }));
  assert.ok(violations.some((x) => x.rule === 'S7'), 'expected an S7 violation');
});

// ---------------------------------------------------------------------------
// CLI exit-code path
// ---------------------------------------------------------------------------

test('CLI exits 1 with [FAIL] output against a broken pack, 0 against a clean one', () => {
  const script = path.join(__dirname, '..', 'scripts', 'validate.js');
  const clean = buildPack();
  const broken = buildPack({ agentCount: 25 });

  const ok = spawnSync(process.execPath, [script, clean], { encoding: 'utf8' });
  assert.strictEqual(ok.status, 0, `clean pack should exit 0:\n${ok.stdout}${ok.stderr}`);

  const bad = spawnSync(process.execPath, [script, broken], { encoding: 'utf8' });
  assert.strictEqual(bad.status, 1, 'broken pack should exit 1');
  assert.ok(/\[FAIL\]/.test(bad.stdout), 'broken pack output should contain [FAIL]');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);