#!/usr/bin/env node

/**
 * Static validation harness for the SWE Pro Agents pack.
 *
 * Zero dependencies (node:fs + node:path only). Lints every agent profile and
 * skill against the rules in plans/phase-1-verification-harness.md and fails
 * (exit 1) on any violation. Wired into CI as `npm run validate`.
 *
 * Run directly:   node scripts/validate.js
 * Via npm:        npm run validate
 *
 * Rule reference (see the plan for the full spec):
 *   Agents  A1 frontmatter parseable · A2 description required/single-line/≤1024
 *           A3 mode valid · A4 primary set exact · A5 subagents not primary
 *           A6 permission task refs known · A7 frontmatter name matches filename
 *           A8 no duplicate names
 *   Skills  S1 SKILL.md exists · S2 frontmatter parseable · S3 name valid+matches dir
 *           S4 description required/≤1024 · S5 license MIT · S6 compatibility opencode
 *           S7 no duplicate names · S8 description has trigger language
 *   Cross   C1 count integrity (files vs package.json vs README) · C2 no stray files
 *
 * Two rules are implemented more narrowly than the plan's literal wording,
 * because the pack itself does not follow the literal form:
 *   - A7: the plan's "else the # <name> heading" fallback is not enforceable —
 *     several agents (swe-reviewer, web-researcher) have no identity H1, and 19
 *     have no H1 at all. We enforce the frontmatter `name` ↔ filename check only.
 *   - A6: task allow/deny lists legitimately reference OpenCode built-ins
 *     (general, explore) and wildcards (swe-*, arch-*), so those are allowed in
 *     addition to known pack subagents.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** The four primary agents. Keep in sync with the pack. */
const PRIMARY_AGENTS = new Set(['swe-pro', 'architect', 'swe-reviewer', 'pr-reviewer']);

/** Expected pack size. Bump when the pack grows. */
const EXPECTED_AGENT_COUNT = 26;
const EXPECTED_SKILL_COUNT = 6;

/** OpenCode built-in agents that may appear in task allow/deny lists. */
const OPENCODE_BUILTINS = new Set(['general', 'explore', 'build', 'plan']);

/** Trigger phrases for the skill description audit (S8). */
const TRIGGER_PHRASES = [
  'use when',
  'use whenever',
  'use this when',
  'trigger on',
  'trigger when',
  'auto-triggers when',
  'whenever the user',
  'when the user',
  'invoke when',
  'use if',
  'when a user',
];

/** Lowercase a name and collapse non-alphanumerics to single hyphens. */
function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extract the raw lines between the first two `---` frontmatter delimiters.
 * Returns null if the delimiters are missing or unbalanced.
 */
function extractFrontmatterLines(content) {
  const lines = content.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  let end = -1;
  for (let i = start + 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  return lines.slice(start + 1, end);
}

/**
 * Minimal YAML frontmatter parser. Returns { ok, data, error }.
 * Handles `key: value`, quoted values, and folded/block scalars (`key: >`).
 * Nested (indented) maps are skipped at the top level — only the `permission`
 * block's `task` allow/deny refs are parsed, via parseTaskRefs().
 */
function parseFrontmatter(content) {
  const lines = extractFrontmatterLines(content);
  if (!lines) return { ok: false, error: 'missing or unbalanced --- delimiters' };

  const data = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Skip blank lines, comments, and nested (indented) keys.
    if (line.trim() === '' || line.trim().startsWith('#') || line.startsWith(' ') || line.startsWith('\t')) {
      i++;
      continue;
    }
    const m = line.trim().match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    let value = m[2].trim();
    if (value === '>' || value === '|') {
      // Block scalar: consume following indented lines. Folded (`>`) joins with
      // a space; literal (`|`) preserves newlines.
      const parts = [];
      i++;
      while (i < lines.length && (lines[i].startsWith(' ') || lines[i].startsWith('\t'))) {
        parts.push(lines[i].trim());
        i++;
      }
      value = value === '|' ? parts.join('\n') : parts.join(' ');
    } else {
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      i++;
    }
    data[key] = value;
  }
  return { ok: true, data };
}

/**
 * Extract task allow/deny references from the `permission.task` block.
 * Returns [{ name, action }]. Names may be wildcards (swe-*, *).
 */
function parseTaskRefs(frontmatterLines) {
  const refs = [];
  let inTask = false;
  for (const line of frontmatterLines) {
    const trimmed = line.trim();
    if (trimmed === 'task:') {
      inTask = true;
      continue;
    }
    if (inTask) {
      // A task entry is indented deeper than `task:`; a non-indented line ends the block.
      if (!line.startsWith(' ') && !line.startsWith('\t')) {
        inTask = false;
        continue;
      }
      const m = trimmed.match(/^(['"]?)([^:]+)\1:\s*(allow|deny)\s*$/);
      if (m) refs.push({ name: m[2].trim(), action: m[3] });
    }
  }
  return refs;
}

/** True if a task ref is a wildcard, a known pack subagent, or an OpenCode built-in. */
function isValidTaskRef(name, knownSubagents) {
  if (name.includes('*')) return true;
  if (knownSubagents.has(name)) return true;
  if (OPENCODE_BUILTINS.has(name)) return true;
  return false;
}

/** Validate a single agent file. Returns an array of { rule, file, detail }. */
function validateAgentFile(filePath, knownSubagents) {
  const violations = [];
  const base = path.basename(filePath, '.md');
  const rule = (id, detail) => violations.push({ rule: id, file: base, detail });

  const content = fs.readFileSync(filePath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm.ok) {
    rule('A1', `frontmatter: ${fm.error}`);
    return violations;
  }
  const d = fm.data;

  // A2 — description required, single line, ≤ 1024 chars.
  if (!d.description || d.description.trim() === '') {
    rule('A2', 'missing description');
  } else if (d.description.includes('\n')) {
    rule('A2', 'description must be a single line');
  } else if (d.description.length > 1024) {
    rule('A2', `description is ${d.description.length} chars (> 1024)`);
  }

  // A3 — mode valid (absent defaults to subagent).
  const mode = d.mode || 'subagent';
  if (mode !== 'primary' && mode !== 'subagent') {
    rule('A3', `invalid mode '${mode}'`);
  }

  // A5 — subagents must not declare mode: primary.
  if (mode === 'primary' && !PRIMARY_AGENTS.has(base)) {
    rule('A5', `subagent '${base}' must not declare mode: primary`);
  }

  // A6 — permission.task allow/deny refs must be known.
  const fmLines = extractFrontmatterLines(content);
  if (fmLines) {
    for (const ref of parseTaskRefs(fmLines)) {
      if (!isValidTaskRef(ref.name, knownSubagents)) {
        rule('A6', `task ${ref.action} references unknown agent '${ref.name}'`);
      }
    }
  }

  // A7 — frontmatter name (if present) must match the filename.
  if (d.name && slugify(d.name) !== base) {
    rule('A7', `frontmatter name '${d.name}' does not match filename '${base}'`);
  }

  return violations;
}

/** Validate a single skill directory. Returns an array of { rule, file, detail }. */
function validateSkillDir(dirPath) {
  const violations = [];
  const dirName = path.basename(dirPath);
  const rule = (id, detail) => violations.push({ rule: id, file: dirName, detail });

  const skPath = path.join(dirPath, 'SKILL.md');

  // S1 — SKILL.md must exist.
  if (!fs.existsSync(skPath)) {
    rule('S1', 'missing SKILL.md');
    return violations;
  }

  const content = fs.readFileSync(skPath, 'utf8');
  const fm = parseFrontmatter(content);
  if (!fm.ok) {
    rule('S2', `frontmatter: ${fm.error}`);
    return violations;
  }
  const d = fm.data;

  // S3 — name required, lowercase alnum + single hyphens, ≤ 64, matches dir.
  if (!d.name) {
    rule('S3', 'missing name');
  } else {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.name)) {
      rule('S3', `invalid name '${d.name}'`);
    } else if (d.name.length > 64) {
      rule('S3', `name is ${d.name.length} chars (> 64)`);
    }
    if (d.name !== dirName) {
      rule('S3', `name '${d.name}' does not match directory '${dirName}'`);
    }
  }

  // S4 — description required, ≤ 1024 chars.
  if (!d.description || d.description.trim() === '') {
    rule('S4', 'missing description');
  } else if (d.description.length > 1024) {
    rule('S4', `description is ${d.description.length} chars (> 1024)`);
  }

  // S5 — license must be MIT.
  if (!d.license) {
    rule('S5', 'missing license');
  } else if (d.license !== 'MIT') {
    rule('S5', `license '${d.license}' != MIT`);
  }

  // S6 — compatibility must be opencode.
  if (!d.compatibility) {
    rule('S6', 'missing compatibility');
  } else if (d.compatibility !== 'opencode') {
    rule('S6', `compatibility '${d.compatibility}' != opencode`);
  }

  // S8 — description must contain trigger language.
  if (d.description) {
    const lower = d.description.toLowerCase();
    if (!TRIGGER_PHRASES.some((p) => lower.includes(p))) {
      rule('S8', 'description has no trigger phrase');
    }
  }

  return violations;
}

/** Number of agent .md files in the pack. */
function getAgentCount(repoDir) {
  return fs.readdirSync(path.join(repoDir, 'agents')).filter((f) => f.endsWith('.md')).length;
}

/** Number of skill directories (with SKILL.md) in the pack. */
function getSkillCount(repoDir) {
  return fs
    .readdirSync(path.join(repoDir, 'skills'), { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(repoDir, 'skills', e.name, 'SKILL.md'))).length;
}

/**
 * Validate the whole pack. Returns { violations, agentCount, skillCount }.
 * `violations` is an array of { rule, file, detail }.
 */
function validatePack(repoDir) {
  const violations = [];
  const agentsDir = path.join(repoDir, 'agents');
  const skillsDir = path.join(repoDir, 'skills');

  // --- Agents ---
  const agentFiles = fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md')).sort();
  const knownSubagents = new Set(agentFiles.map((f) => path.basename(f, '.md')));

  // C2 — agents/ contains only .md files.
  for (const entry of fs.readdirSync(agentsDir)) {
    const full = path.join(agentsDir, entry);
    if (!fs.statSync(full).isFile() || !entry.endsWith('.md')) {
      violations.push({ rule: 'C2', file: 'agents', detail: `stray entry '${entry}'` });
    }
  }

  const primaryDeclared = new Set();
  const declaredNames = new Set();
  for (const f of agentFiles) {
    const full = path.join(agentsDir, f);
    violations.push(...validateAgentFile(full, knownSubagents));

    // Track primary declarations and names for A4 / A8.
    const base = path.basename(f, '.md');
    const fm = parseFrontmatter(fs.readFileSync(full, 'utf8'));
    if (fm.ok && fm.data.mode === 'primary') primaryDeclared.add(base);
    const name = fm.ok && fm.data.name ? fm.data.name : base;
    if (declaredNames.has(name)) {
      violations.push({ rule: 'A8', file: base, detail: `duplicate agent name '${name}'` });
    }
    declaredNames.add(name);
  }

  // A4 — the primary set must be exactly PRIMARY_AGENTS, each declaring primary.
  for (const p of PRIMARY_AGENTS) {
    if (!primaryDeclared.has(p)) {
      violations.push({ rule: 'A4', file: p, detail: `primary agent '${p}' must declare mode: primary` });
    }
  }
  for (const p of primaryDeclared) {
    if (!PRIMARY_AGENTS.has(p)) {
      violations.push({ rule: 'A4', file: p, detail: `unexpected primary agent '${p}'` });
    }
  }

  // --- Skills ---
  const skillDirs = fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  // C2 — skills/ contains only directories with SKILL.md.
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      violations.push({ rule: 'C2', file: 'skills', detail: `stray entry '${entry.name}'` });
    } else if (!fs.existsSync(path.join(skillsDir, entry.name, 'SKILL.md'))) {
      violations.push({ rule: 'C2', file: entry.name, detail: 'skill directory missing SKILL.md' });
    }
  }

  const skillNames = new Set();
  for (const dir of skillDirs) {
    violations.push(...validateSkillDir(path.join(skillsDir, dir)));

    // S7 — no duplicate skill names.
    const skPath = path.join(skillsDir, dir, 'SKILL.md');
    if (fs.existsSync(skPath)) {
      const fm = parseFrontmatter(fs.readFileSync(skPath, 'utf8'));
      if (fm.ok && fm.data.name) {
        if (skillNames.has(fm.data.name)) {
          violations.push({ rule: 'S7', file: dir, detail: `duplicate skill name '${fm.data.name}'` });
        }
        skillNames.add(fm.data.name);
      }
    }
  }

  // --- Cross-cutting ---
  const agentCount = agentFiles.length;
  const skillCount = skillDirs.length;

  // C1 — counts match the expected pack size.
  if (agentCount !== EXPECTED_AGENT_COUNT) {
    violations.push({ rule: 'C1', file: 'agents', detail: `expected ${EXPECTED_AGENT_COUNT} agents, found ${agentCount}` });
  }
  if (skillCount !== EXPECTED_SKILL_COUNT) {
    violations.push({ rule: 'C1', file: 'skills', detail: `expected ${EXPECTED_SKILL_COUNT} skills, found ${skillCount}` });
  }

  // C1 — counts claimed in package.json description and README.
  const pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8'));
  const desc = pkg.description || '';
  if (!desc.includes(String(EXPECTED_AGENT_COUNT))) {
    violations.push({ rule: 'C1', file: 'package.json', detail: `description does not mention ${EXPECTED_AGENT_COUNT} agents` });
  }
  if (!desc.includes(String(EXPECTED_SKILL_COUNT))) {
    violations.push({ rule: 'C1', file: 'package.json', detail: `description does not mention ${EXPECTED_SKILL_COUNT} skills` });
  }

  const readmePath = path.join(repoDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    const readme = fs.readFileSync(readmePath, 'utf8');
    if (!readme.includes(String(EXPECTED_AGENT_COUNT))) {
      violations.push({ rule: 'C1', file: 'README.md', detail: `README does not mention ${EXPECTED_AGENT_COUNT} agents` });
    }
    if (!readme.includes(`${EXPECTED_SKILL_COUNT} skills`)) {
      violations.push({ rule: 'C1', file: 'README.md', detail: `README does not mention ${EXPECTED_SKILL_COUNT} skills` });
    }
  }

  return { violations, agentCount, skillCount };
}

// --- CLI entry point ---
if (require.main === module) {
  const repoDir = path.resolve(__dirname, '..');
  const { violations, agentCount, skillCount } = validatePack(repoDir);

  for (const v of violations) {
    console.log(`[FAIL] ${v.file}: ${v.rule} — ${v.detail}`);
  }

  if (violations.length > 0) {
    console.log(`\n${violations.length} violation(s) across ${agentCount} agents, ${skillCount} skills.`);
    process.exit(1);
  }

  console.log(`OK — ${agentCount} agents, ${skillCount} skills, 0 violations.`);
}

module.exports = {
  slugify,
  extractFrontmatterLines,
  parseFrontmatter,
  parseTaskRefs,
  isValidTaskRef,
  validateAgentFile,
  validateSkillDir,
  getAgentCount,
  getSkillCount,
  validatePack,
  PRIMARY_AGENTS,
  EXPECTED_AGENT_COUNT,
  EXPECTED_SKILL_COUNT,
};