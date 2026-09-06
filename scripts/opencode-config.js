'use strict';

/**
 * opencode-config — ensure the agents-path entry in opencode.json.
 *
 * Shared by the postinstall hook (scripts/install.js, automatic) and the
 * `swe-pro-agents setup --apply` command (bin/, explicit). One implementation
 * so both behave identically: idempotent, backup before overwrite, never
 * destructive on unparseable config.
 *
 * Entry shape: { "agents": [{ "path": <agentsDir> }] }. An entry whose path
 * contains 'swe-pro-agents' counts as present (covers equivalent spellings).
 *
 * Outcomes (no console output here — callers report):
 *   written     — entry added (backup path returned when one was made)
 *   present     — an entry already referenced the pack; untouched
 *   missing-dir — the config directory does not exist; caller decides
 *   unparseable — file exists but is not JSON; nothing changed
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';

function defaultConfigPath() {
  try {
    return path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  } catch {
    return null;
  }
}

function ensureAgentPathEntry(configPath, agentsPath) {
  if (!configPath || typeof configPath !== 'string') {
    return { outcome: 'missing-dir' };
  }
  let configDir = null;
  try {
    configDir = path.dirname(configPath);
  } catch {
    return { outcome: 'missing-dir' };
  }
  if (!configDir || !fs.existsSync(configDir)) {
    return { outcome: 'missing-dir' };
  }
  let config = {};
  let existed = false;
  if (fs.existsSync(configPath)) {
    existed = true;
    let raw = null;
    try {
      raw = fs.readFileSync(configPath, 'utf-8').replace(/^\uFEFF/, '');
      config = JSON.parse(raw);
    } catch {
      return { outcome: 'unparseable' };
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return { outcome: 'unparseable' };
    }
  }
  if (!Array.isArray(config.agents)) config.agents = [];
  const present = config.agents.some((a) => String((a && a.path) || '').includes(PACKAGE_NAME));
  if (present) {
    return { outcome: 'present' };
  }
  let backup = null;
  if (existed) {
    backup = configPath + '.bak';
    fs.copyFileSync(configPath, backup);
  }
  config.agents.push({ path: agentsPath });
  const tmp = configPath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(config, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, configPath);
  return { outcome: 'written', backup };
}

module.exports = { PACKAGE_NAME, defaultConfigPath, ensureAgentPathEntry };
