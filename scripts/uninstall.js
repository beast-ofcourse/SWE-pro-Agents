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
    console.log(`[${PACKAGE_NAME}] Removed agent files (including the package's own`);
    console.log(`  AGENTS.md copy) from:`);
    console.log(`  ${TARGET_DIR}`);
    console.log();
    console.log(`  Note: your opencode.json still references this path — remove that`);
    console.log(`  entry manually. If you merged this pack's AGENTS.md content into`);
    console.log(`  your global ~/.config/opencode/AGENTS.md, that merge is untouched;`);
    console.log(`  edit it yourself if you want those sections removed too.`);
  } catch (err) {
    console.error(`[${PACKAGE_NAME}] Uninstall failed:`, err.message);
    process.exit(1);
  }
}

main();
