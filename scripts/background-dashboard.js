'use strict';

// ---------------------------------------------------------------------------
// Deep module: background-dashboard (bg_dashboard tree + bg_status --json)
// ---------------------------------------------------------------------------
// Single source for the operator glance views (user-flow Persona 1 Journey B,
// Persona 2): renderTree() is the human tree, toJson() the machine shape with
// a per-item logPath. Both are total — partial/foreign list items degrade to
// '-'/'unknown' placeholders, never throw.
//
// Projection note: listDelegations() projects branch/tokens/createdAt/updatedAt
// (T-034), so branch and age render real values; tokens renders once the
// engine persists a tokens snapshot on heartbeat refresh (evaluateTerminal).

const path = require('path');

const NO_ACTIVE_DELEGATIONS = 'no active delegations';

function dashboardText(value, fallback) {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return fallback;
}

function dashboardBranch(item) {
  if (item && typeof item.branch === 'string' && item.branch) return item.branch;
  if (item && item.worktree && typeof item.worktree.branch === 'string' && item.worktree.branch) return item.worktree.branch;
  return '-';
}

function dashboardTokens(item) {
  const tokens = item ? item.tokens : undefined;
  if (typeof tokens === 'number' && Number.isFinite(tokens)) return String(tokens);
  if (typeof tokens === 'string' && tokens) return tokens;
  if (tokens && typeof tokens === 'object') {
    const input = typeof tokens.input === 'number' ? tokens.input
      : typeof tokens.inputTokens === 'number' ? tokens.inputTokens : 0;
    const output = typeof tokens.output === 'number' ? tokens.output
      : typeof tokens.outputTokens === 'number' ? tokens.outputTokens : 0;
    if (input || output) return String(input + output);
    if (typeof tokens.total === 'number') return String(tokens.total);
    if (typeof tokens.totalTokens === 'number') return String(tokens.totalTokens);
  }
  return '-';
}

function dashboardAge(item, now) {
  const candidates = item
    ? [item.heartbeatAt, item.updatedAt, item.createdAt]
    : [];
  let stamp = null;
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      stamp = candidate;
      break;
    }
  }
  if (stamp === null) return '-';
  const elapsed = now - stamp;
  if (!Number.isFinite(elapsed) || elapsed < 0) return '0s';
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h';
  return Math.floor(hours / 24) + 'd';
}

function dashboardLine(item, prefix, now) {
  const id = dashboardText(item && item.id, 'unknown');
  const state = dashboardText(item && item.state, 'unknown');
  const agent = dashboardText(item && item.agent, '-');
  return prefix + id + ' [' + state + '] agent:' + agent
    + ' branch:' + dashboardBranch(item)
    + ' tokens:' + dashboardTokens(item)
    + ' age:' + dashboardAge(item, now);
}

function renderTree(list) {
  try {
    if (!Array.isArray(list) || list.length === 0) return NO_ACTIVE_DELEGATIONS;
    const now = Date.now();
    return list.map((item, index) => {
      try {
        const last = index === list.length - 1;
        return dashboardLine(item, last ? '└─ ' : '├─ ', now);
      } catch {
        return '└─ ' + dashboardText(item && item.id, 'unknown') + ' [unknown]';
      }
    }).join('\n');
  } catch {
    return NO_ACTIVE_DELEGATIONS;
  }
}

function dashboardLogPath(id, storeDir) {
  const name = dashboardText(id, 'unknown') + '.log';
  if (typeof storeDir === 'string' && storeDir) return path.join(storeDir, name);
  return name;
}

function dashboardEntry(item, storeDir) {
  try {
    const base = item && typeof item === 'object' && !Array.isArray(item)
      ? Object.assign({}, item)
      : {};
    if (base.id === null || base.id === undefined) base.id = 'unknown';
    else base.id = String(base.id);
    base.logPath = dashboardLogPath(base.id, storeDir);
    return base;
  } catch {
    return { id: 'unknown', logPath: dashboardLogPath('unknown', storeDir) };
  }
}

function toJson(list, storeDir) {
  try {
    if (!Array.isArray(list)) return [];
    return list.map((item) => dashboardEntry(item, storeDir));
  } catch {
    return [];
  }
}

module.exports = { renderTree, toJson };
