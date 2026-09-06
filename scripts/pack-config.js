'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Feature flag: /goal enablement (mirrors scripts/pack-config.js isGoalEnabled)
// ---------------------------------------------------------------------------
const GOAL_CONFIG_FILE = 'swe-pro-agents.config.json';

// Global flag lives beside the install manifest (~/.config/swe-pro-agents/),
// written by the installer's component selection ("Goal system" unchecked).
// A project-level flag file, when it states an explicit boolean, always wins;
// the global file applies when the project is silent; default is enabled.
function globalConfigPath() {
  try {
    return path.join(os.homedir(), '.config', 'swe-pro-agents', GOAL_CONFIG_FILE);
  } catch {
    return null;
  }
}

// Read an explicit boolean goal value from a config file path.
// Returns true/false, or undefined when absent, unreadable, or corrupt —
// callers fall through to the next scope on undefined (fail-open default).
function readGoalValue(filePath) {
  if (!filePath || typeof filePath !== 'string') return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const value = parsed && parsed.features && parsed.features.goal;
    return typeof value === 'boolean' ? value : undefined;
  } catch {
    return undefined;
  }
}

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
    const projectPath = directory && typeof directory === 'string'
      ? path.join(directory, GOAL_CONFIG_FILE)
      : null;
    const projectValue = readGoalValue(projectPath);
    if (projectValue !== undefined) return projectValue;
    const globalValue = readGoalValue(globalConfigPath());
    if (globalValue !== undefined) return globalValue;
  } catch {
    /* fall through to fail-open default */
  }
  return true;
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

// Merge `features` into the GLOBAL config (beside the install manifest),
// preserving other keys. Atomic write. Used by the installer's component
// selection ("Goal system" unchecked writes { goal: false }).
function writeGlobalConfig(features) {
  const p = globalConfigPath();
  if (!p) return; // cannot resolve a home directory
  let existing = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (parsed && typeof parsed === 'object') existing = parsed;
  } catch {}
  const next = { ...existing, features: { ...(existing.features || {}), ...features } };
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, p);
}

module.exports = { CONFIG_FILE, defaultConfig, configPath, loadConfig, isGoalEnabled, writeConfig, globalConfigPath, readGoalValue, writeGlobalConfig };
