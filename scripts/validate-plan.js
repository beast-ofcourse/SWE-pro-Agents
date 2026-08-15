#!/usr/bin/env node

/**
 * Static validation harness for project plan directories.
 *
 * Zero dependencies (node:fs + node:path only). Validates the plan artifacts
 * a project keeps under `plans/` — tasks.md and (optionally) state.json —
 * against the rules below and fails (exit 1) on any violation. Wired into
 * package.json as `npm run validate:plan`.
 *
 * Run directly:   node scripts/validate-plan.js [planDir]
 * Via npm:        npm run validate:plan
 *
 * Rules (plan rules are project rules, not pack rules):
 *   P1  Plan presence — tasks.md exists and contains at least one `### T-###`
 *       heading.
 *   P2  Task shape — every `### T-###` heading has **Build.**,
 *       **Acceptance criteria.**, and **Verify.** sections (the title falls
 *       back to the heading text; **Phase.** is optional); task ids are unique.
 *   P3  Ledger consistency — if state.json exists, its task ids match tasks.md
 *       exactly (no orphans, no missing) and its status is one of
 *       running|paused|blocked|done|aborted.
 */

'use strict';

const fs = require('fs');
const path = require('path');

/** Allowed ledger statuses (P3). */
const VALID_STATUSES = new Set(['running', 'paused', 'blocked', 'done', 'aborted']);

/** The three required task sections (P2). */
const REQUIRED_SECTIONS = ['**Build.**', '**Acceptance criteria.**', '**Verify.**'];

/**
 * Extract `### T-###` task headings from tasks.md content.
 * Returns [{ id, title, body }] where `title` is the heading text after the
 * id (the fallback when a task has no explicit title) and `body` is the text
 * between this heading and the next task heading (or end of file).
 */
function extractTasks(content) {
  const tasks = [];
  let current = null;
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^###\s+(T-\d+)(?:\s*(?:—|-)\s*(.*))?$/);
    if (m) {
      current = { id: m[1], title: (m[2] || '').trim(), body: [] };
      tasks.push(current);
    } else if (current) {
      current.body.push(line);
    }
  }
  for (const t of tasks) t.body = t.body.join('\n');
  return tasks;
}

/** True if any line of `body` starts with `marker` (P2 section check). */
function hasSection(body, marker) {
  return body.split(/\r?\n/).some((line) => line.trim().startsWith(marker));
}

/**
 * Validate a plan directory. Returns an array of { rule, file, detail }.
 * P1 failure short-circuits: without tasks.md there are no task ids to shape
 * (P2) or reconcile (P3) against.
 */
function validatePlanDir(planDir) {
  const violations = [];
  const rule = (id, file, detail) => violations.push({ rule: id, file, detail });

  const tasksPath = path.join(planDir, 'tasks.md');

  // P1 — plan presence.
  if (!fs.existsSync(tasksPath)) {
    rule('P1', 'tasks.md', 'missing tasks.md');
    return violations;
  }
  const tasks = extractTasks(fs.readFileSync(tasksPath, 'utf8'));
  if (tasks.length === 0) {
    rule('P1', 'tasks.md', 'no `### T-###` task headings found');
    return violations;
  }

  // P2 — task shape.
  const seen = new Set();
  for (const t of tasks) {
    if (seen.has(t.id)) {
      rule('P2', 'tasks.md', `duplicate task id '${t.id}'`);
    }
    seen.add(t.id);
    for (const marker of REQUIRED_SECTIONS) {
      if (!hasSection(t.body, marker)) {
        rule('P2', t.id, `missing '${marker}' section`);
      }
    }
  }

  // P3 — ledger consistency (only when state.json exists).
  const statePath = path.join(planDir, 'state.json');
  if (fs.existsSync(statePath)) {
    let state;
    try {
      state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch (err) {
      rule('P3', 'state.json', `unparseable JSON: ${err.message}`);
      return violations;
    }
    if (!state || typeof state !== 'object' || !Array.isArray(state.tasks)) {
      rule('P3', 'state.json', 'missing `tasks` array');
      return violations;
    }
    if (typeof state.status !== 'string' || !VALID_STATUSES.has(state.status)) {
      rule('P3', 'state.json', `invalid status '${state.status}' (expected one of ${[...VALID_STATUSES].join('|')})`);
    }
    const ledgerIds = state.tasks
      .map((t) => (t && typeof t.id === 'string' ? t.id : null))
      .filter((id) => id !== null);
    const planIds = tasks.map((t) => t.id);
    const planSet = new Set(planIds);
    const ledgerSet = new Set(ledgerIds);
    for (const id of ledgerIds) {
      if (!planSet.has(id)) {
        rule('P3', 'state.json', `orphan task '${id}' in ledger (not in tasks.md)`);
      }
    }
    for (const id of planIds) {
      if (!ledgerSet.has(id)) {
        rule('P3', 'state.json', `missing task '${id}' in ledger (in tasks.md but not state.json)`);
      }
    }
  }

  return violations;
}

// --- CLI entry point ---
if (require.main === module) {
  // Optional positional arg: the plan dir to validate. Defaults to `plans/`
  // relative to the current working directory (npm run validate:plan).
  const planDir = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('plans');
  const violations = validatePlanDir(planDir);

  for (const v of violations) {
    console.log(`[FAIL] ${v.file}: ${v.rule} — ${v.detail}`);
  }

  if (violations.length > 0) {
    console.log(`\n${violations.length} violation(s) in ${planDir}.`);
    process.exit(1);
  }

  console.log(`OK — ${planDir}: 0 violations.`);
}

module.exports = {
  extractTasks,
  hasSection,
  validatePlanDir,
  VALID_STATUSES,
  REQUIRED_SECTIONS,
};