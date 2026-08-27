'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_FILE = 'swe-pro-agents.config.json';

function defaultConfig() {
  return { features: { goal: true } };
}

function configPath(directory) {
  if (!directory || typeof directory !== 'string') return null;
  return path.join(directory, CONFIG_FILE);
}

function loadConfig(directory) {
  const p = configPath(directory);
  if (!p) return defaultConfig();

  let raw;
  try {
    raw = fs.readFileSync(p, 'utf8');
  } catch {
    return defaultConfig();
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultConfig();
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return defaultConfig();
  if (!parsed.features || typeof parsed.features !== 'object') return defaultConfig();

  return parsed;
}

function isGoalEnabled(directory) {
  try {
    const c = loadConfig(directory);
    return !!(c.features && c.features.goal !== false);
  } catch {
    return true;
  }
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
