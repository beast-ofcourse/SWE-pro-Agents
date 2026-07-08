#!/usr/bin/env node

/**
 * postinstall — copies agent files to ~/.config/opencode/agents/swe-pro-agents/
 *
 * Runs automatically after `npm install -g swe-pro-agents`.
 * User still needs to add the path to their opencode.json or AGENTS.md once.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const TARGET_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);

function getSourceDir() {
  // __dirname = <package_root>/scripts/
  return path.resolve(__dirname, '..', 'agents');
}

function copyRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  const entries = fs.readdirSync(src, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      count += copyRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      count++;
    }
  }

  return count;
}

function main() {
  const sourceDir = getSourceDir();

  if (!fs.existsSync(sourceDir)) {
    console.error(`[${PACKAGE_NAME}] ERROR: agents/ directory not found at ${sourceDir}`);
    process.exit(1);
  }

  try {
    const fileCount = copyRecursive(sourceDir, TARGET_DIR);
    console.log(`[${PACKAGE_NAME}] Installed ${fileCount} agent files to:`);
    console.log(`  ${TARGET_DIR}`);
    console.log();
    console.log(`  Next step: add this path to your opencode.json or AGENTS.md:`);
    console.log(`  { "agents": [{ "path": "${TARGET_DIR.replace(/\\/g, '\\\\')}" }] }`);
    console.log();
    console.log(`  Or run:  swe-pro-agents setup`);
  } catch (err) {
    console.error(`[${PACKAGE_NAME}] Install failed:`, err.message);
    process.exit(1);
  }
}

main();
