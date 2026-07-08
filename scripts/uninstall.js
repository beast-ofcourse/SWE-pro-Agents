#!/usr/bin/env node

/**
 * preuninstall — removes agent files from ~/.config/opencode/agents/swe-pro-agents/
 *
 * Runs automatically before `npm uninstall -g swe-pro-agents`.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const TARGET_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);

function main() {
  if (!fs.existsSync(TARGET_DIR)) {
    console.log(`[${PACKAGE_NAME}] Nothing to remove — directory not found.`);
    return;
  }

  try {
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
    console.log(`[${PACKAGE_NAME}] Removed agent files from:`);
    console.log(`  ${TARGET_DIR}`);
    console.log();
    console.log(`  Note: your opencode.json or AGENTS.md still references this path.`);
    console.log(`  Remove that entry manually if you no longer use these agents.`);
  } catch (err) {
    console.error(`[${PACKAGE_NAME}] Uninstall failed:`, err.message);
    process.exit(1);
  }
}

main();
