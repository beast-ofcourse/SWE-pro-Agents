'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Feature flag: /goal enablement (mirrors scripts/pack-config.js isGoalEnabled)
// ---------------------------------------------------------------------------
const GOAL_CONFIG_FILE = 'swe-pro-agents.config.json';

function loadGoalConfig(directory) {
  const p = directory && typeof directory === 'string' ? path.join(directory, GOAL_CONFIG_FILE) : null;
  if (!p) return { features: { goal: true } };
  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return { features: { goal: true } };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { features: { goal: true } };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { features: { goal: true } };
  if (!parsed.features || typeof parsed.features !== 'object') return { features: { goal: true } };
  return parsed;
}

function isGoalEnabled(directory) {
  try {
    const c = loadGoalConfig(directory);
    return !!(c.features && c.features.goal !== false);
  } catch {
    return true;
  }
}

// CLI-only helpers (consumed by bin/ and tests). They are inlined into the
// generated plugin section too, where they are inert (pure, never called).
const CONFIG_FILE = GOAL_CONFIG_FILE;

function defaultConfig() {
  return { features: { goal: true } };
}

function configPath(directory) {
  if (!directory || typeof directory !== 'string') return null;
  return path.join(directory, CONFIG_FILE);
}

function loadConfig(directory) {
  return loadGoalConfig(directory);
}

// Merge `features` into the project config, preserving other keys. Atomic write.
// Missing/invalid file is treated as the default config before merge.
function writeConfig(directory, features) {
  const p = configPath(directory);
  if (!p) return; // cannot write without a directory

  let existing = {};
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') existing = parsed;
  } catch {}
  const next = { ...existing, features: { ...(existing.features || {}), ...features } };
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

module.exports = { CONFIG_FILE, defaultConfig, configPath, loadConfig, isGoalEnabled, writeConfig };
