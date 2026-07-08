#!/usr/bin/env node

/**
 * postinstall — copies agent files + teams to ~/.config/opencode/agents/swe-pro-agents/
 *
 * Runs automatically after `npm install -g swe-pro-agents`.
 * User still needs to add the path to their opencode.json or AGENTS.md once.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const TARGET_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);

function getSourceDir(name) {
  // __dirname = <package_root>/scripts/
  return path.resolve(__dirname, '..', name);
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

function ensureTargetDir(target) {
  fs.mkdirSync(target, { recursive: true });
}

function main() {
  // Copy individual agents
  const agentsSource = getSourceDir('agents');
  if (!fs.existsSync(agentsSource)) {
    console.error(`[${PACKAGE_NAME}] ERROR: agents/ directory not found`);
    process.exit(1);
  }

  try {
    const agentCount = copyRecursive(agentsSource, TARGET_DIR);
    console.log(`[${PACKAGE_NAME}] Installed ${agentCount} individual agent files`);
    console.log(`  → ${TARGET_DIR}`);

    // Copy teams (if present)
    const teamsSource = getSourceDir('teams');
    if (fs.existsSync(teamsSource)) {
      const teamEntries = fs.readdirSync(teamsSource, { withFileTypes: true });
      for (const entry of teamEntries) {
        if (entry.isDirectory()) {
          const srcPath = path.join(teamsSource, entry.name);
          const destPath = path.join(TARGET_DIR, 'teams', entry.name);
          ensureTargetDir(path.dirname(destPath));
          const teamFileCount = copyRecursive(srcPath, destPath);
          console.log(`[${PACKAGE_NAME}] Installed team "${entry.name}" (${teamFileCount} files)`);
          console.log(`  → ${destPath}`);
        }
      }
    }

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
