'use strict';

/**
 * install-select — component selection for the installer and the setup CLI.
 *
 * Lets users pick exactly which agents, skills, and systems get installed
 * instead of forcing the whole pack:
 *   - agents: every agents profile file, shown with its one-line description
 *   - skills: every skill directory, shown with its description
 *   - systems: `background` (bg_delegate… tools — the plugin file) and
 *     `goal` (the /goal command + idle nudge — a flag, not a file)
 *
 * Zero dependencies, plain readline, Windows-safe. Prompting is TTY-gated
 * (shouldPrompt): CI, non-TTY, and SWE_PRO_AGENTS_NO_PROMPT runs never block.
 * Non-interactive callers use resolveSelection() with explicit values.
 */

const fs = require('fs');
const path = require('path');

function pkgDir() {
  return path.resolve(__dirname, '..');
}

const DESC_MAX = 76;

/** First `description:` frontmatter line of a markdown file, unquoted. */
function readDescription(mdPath) {
  try {
    const text = fs.readFileSync(mdPath, 'utf8');
    const lines = text.split(/\r?\n/);
    let start = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        start = i;
        break;
      }
    }
    if (start < 0) return '';
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === '---') break;
      if (/^[ \t]/.test(line)) continue;
      const m = line.match(/^description:\s*(.*)$/);
      if (!m) continue;
      let value = m[1].trim();
      if (
        (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
        (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
      ) {
        value = value.slice(1, -1);
      }
      return value;
    }
  } catch {
    /* unreadable file: no description */
  }
  return '';
}

function truncate(text, max) {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + '…';
}

/** Agent options: { kind, name (profile id), file, description }. Sorted. */
function listAgentOptions() {
  const dir = path.join(pkgDir(), 'agents');
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'AGENTS.md');
  } catch {
    return [];
  }
  return files
    .sort()
    .map((file) => ({
      kind: 'agent',
      name: path.basename(file, '.md'),
      file,
      description: truncate(readDescription(path.join(dir, file)), DESC_MAX),
    }));
}

/** Skill options: { kind, name (directory), description }. Sorted. */
function listSkillOptions() {
  const dir = path.join(pkgDir(), 'skills');
  let entries = [];
  try {
    entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return entries
    .sort()
    .map((name) => ({
      kind: 'skill',
      name,
      description: truncate(readDescription(path.join(dir, name, 'SKILL.md')), DESC_MAX),
    }));
}

/** System options: installed plugin file vs. goal flag. Fixed order. */
function listSystemOptions() {
  return [
    {
      kind: 'system',
      id: 'background',
      name: 'Background subagent tools',
      description: 'bg_delegate, bg_read, bg_dashboard… (the plugin file)',
    },
    {
      kind: 'system',
      id: 'goal',
      name: 'Goal system (/goal + idle nudge)',
      description: 'autonomous-loop nudges; off installs the plugin disabled',
    },
  ];
}

/**
 * Parse a multi-select answer against `count` items (1-based numbers).
 * Accepts: '' / 'all' (everything), 'none' (nothing), comma/space-separated
 * numbers and ranges ('1,3,5-8'), and '-N' exclusions off everything
 * ('all,-3' or just '-3' meaning all-but). Returns { ok, indexes } with
 * 0-based indexes, or { ok: false, error } on any invalid token.
 */
function parsePick(input, count) {
  const text = String(input == null ? '' : input).trim().toLowerCase();
  if (text === '' || text === 'all') {
    return { ok: true, indexes: new Set(Array.from({ length: count }, (_, i) => i)) };
  }
  if (text === 'none') {
    return { ok: true, indexes: new Set() };
  }
  const tokens = text.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: true, indexes: new Set(Array.from({ length: count }, (_, i) => i)) };
  }
  const positives = [];
  const exclusions = [];
  for (const token of tokens) {
    if (token === 'all') continue;
    let m = token.match(/^(-?)(\d+)-(\d+)$/);
    if (m) {
      const from = parseInt(m[2], 10);
      const to = parseInt(m[3], 10);
      if (from < 1 || to < 1 || from > count || to > count || from > to) {
        return { ok: false, error: `range '${token}' is out of bounds (1-${count})` };
      }
      const range = [];
      for (let i = from; i <= to; i++) range.push(i - 1);
      (m[1] === '-' ? exclusions : positives).push(...range);
      continue;
    }
    m = token.match(/^(-?)(\d+)$/);
    if (m) {
      const n = parseInt(m[2], 10);
      if (n < 1 || n > count) {
        return { ok: false, error: `'${token}' is out of bounds (1-${count})` };
      }
      (m[1] === '-' ? exclusions : positives).push(n - 1);
      continue;
    }
    return { ok: false, error: `cannot parse '${token}' (want numbers like 1,3,5-8, or all/none)` };
  }
  const base = positives.length > 0 ? positives : Array.from({ length: count }, (_, i) => i);
  const picked = new Set(base);
  for (const i of exclusions) picked.delete(i);
  return { ok: true, indexes: picked };
}

/**
 * Resolve explicit (non-interactive) selection values against the pack.
 * Each of agents/skills accepts undefined (no opinion → null), 'all',
 * 'none', or a comma-separated name list (unknown names throw).
 * background/goal accept undefined (→ null), booleans, or 'true'/'false'/'1'/'0'.
 * Returns { agents, skills, background, goal } with nulls where no opinion.
 */
function resolveSelection(values, pack) {
  const out = { agents: null, skills: null, background: null, goal: null };
  const resolveNames = (value, known, label) => {
    if (value === undefined || value === null) return null;
    const text = String(value).trim().toLowerCase();
    if (text === '' || text === 'all') return [...known];
    if (text === 'none') return [];
    const names = String(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = names.filter((n) => !known.includes(n));
    if (unknown.length > 0) {
      throw new Error(`unknown ${label}: ${unknown.join(', ')} (pack ships: ${known.join(', ')})`);
    }
    return [...new Set(names)];
  };
  const resolveFlag = (value) => {
    if (value === undefined || value === null) return null;
    if (typeof value === 'boolean') return value;
    const text = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(text)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(text)) return false;
    throw new Error(`want true/false, got '${value}'`);
  };
  out.agents = resolveNames(values.agents, pack.agents, 'agents');
  out.skills = resolveNames(values.skills, pack.skills, 'skills');
  out.background = resolveFlag(values.background);
  out.goal = resolveFlag(values.goal);
  return out;
}

/** True only when prompting is safe: a TTY, not CI, not explicitly silenced. */
function shouldPrompt() {
  if (process.env.SWE_PRO_AGENTS_NO_PROMPT) return false;
  const ci = process.env.CI;
  if (ci && ci !== '0' && ci.toLowerCase() !== 'false') return false;
  return !!process.stdin.isTTY;
}

function askLine(rl, question) {
  return new Promise((resolve) => {
    if (rl.closed) {
      resolve('');
      return;
    }
    let done = false;
    const finish = (value) => {
      if (!done) {
        done = true;
        resolve(value);
      }
    };
    // Piped stdin ending early resolves the default instead of hanging.
    rl.once('close', () => finish(''));
    try {
      rl.question(question, (answer) => finish(String(answer)));
    } catch {
      finish('');
    }
  });
}

/** Interactive yes/no (default from defaultYes). TTY only — else the default. */
async function promptYesNo(question, defaultYes, rl) {
  if (!process.stdin.isTTY && !rl) return !!defaultYes;
  const readline = require('readline');
  const own = !rl;
  const io = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await askLine(io, `${question} [${defaultYes ? 'Y/n' : 'y/N'}] `)).trim().toLowerCase();
    if (answer === '') return !!defaultYes;
    if (['y', 'yes'].includes(answer)) return true;
    if (['n', 'no'].includes(answer)) return false;
    return !!defaultYes;
  } finally {
    if (own) io.close();
  }
}

/**
 * Interactive numbered multi-select. Prints items with truncated
 * descriptions, loops until the answer parses. Returns the picked items.
 */
async function promptMultiSelect(title, items, rl) {
  const readline = require('readline');
  console.log(`\n  ${title} (${items.length}):`);
  items.forEach((item, i) => {
    const label = item.kind === 'agent' || item.kind === 'skill' ? item.name : item.id;
    const extra = item.description ? ` — ${item.description}` : '';
    console.log(`    ${(i + 1).toString().padStart(2)}. ${label}${extra}`);
  });
  const own = !rl;
  const io = rl || readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = await askLine(io, `  Pick [all] (numbers, ranges, all/none, -N to exclude): `);
      const parsed = parsePick(answer, items.length);
      if (parsed.ok) return items.filter((_, i) => parsed.indexes.has(i));
      console.log(`  Invalid: ${parsed.error} — try again.`);
    }
  } finally {
    if (own) io.close();
  }
}

/**
 * Full interactive selection: agents, then skills, then the two systems.
 * Returns { agents: [files], skills: [names], background: bool, goal: bool }.
 */
async function promptSelection() {
  // One shared interface for the whole flow: sequential interfaces drop
  // buffered piped input on close, and four separate prompts would each
  // re-buffer. TTY input arrives per keystroke so it never noticed — pipes do.
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const agents = await promptMultiSelect('Agents to install', listAgentOptions(), rl);
    const skills = await promptMultiSelect('Skills to install', listSkillOptions(), rl);
    console.log();
    const background = await promptYesNo('Install background subagent tools (bg_delegate…)?', true, rl);
    const goal = await promptYesNo('Enable the goal system (/goal + idle nudges)?', true, rl);
    return {
      agents: agents.map((a) => a.file),
      skills: skills.map((s) => s.name),
      background,
      goal,
    };
  } finally {
    rl.close();
  }
}

module.exports = {
  listAgentOptions,
  listSkillOptions,
  listSystemOptions,
  parsePick,
  resolveSelection,
  shouldPrompt,
  promptYesNo,
  promptMultiSelect,
  promptSelection,
};
