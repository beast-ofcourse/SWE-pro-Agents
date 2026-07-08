#!/usr/bin/env node

/**
 * postinstall — copies agent files to ~/.config/opencode/agents/swe-pro-agents/
 *                and skill files to ~/.config/opencode/skills/
 *
 * Runs automatically after `npm install -g swe-pro-agents`.
 * User still needs to add the agent path to their opencode.json or AGENTS.md once.
 * Skills are auto-discovered by OpenCode once placed in ~/.config/opencode/skills/.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const AGENTS_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);
const SKILLS_DIR = path.join(os.homedir(), '.config', 'opencode', 'skills');

function pkgDir() {
  return path.resolve(__dirname, '..');
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

function copySkills() {
  const src = path.join(pkgDir(), 'skills');
  if (!fs.existsSync(src)) return 0;

  // Each subdirectory under skills/ is a skill (has a SKILL.md)
  const skills = fs.readdirSync(src, { withFileTypes: true })
    .filter(e => e.isDirectory());

  let count = 0;
  for (const skill of skills) {
    const skillSrc = path.join(src, skill.name);
    const skillDest = path.join(SKILLS_DIR, skill.name);
    count += copyRecursive(skillSrc, skillDest);
  }
  return count;
}

function main() {
  const agentSrc = path.join(pkgDir(), 'agents');

  if (!fs.existsSync(agentSrc)) {
    console.error(`[${PACKAGE_NAME}] ERROR: agents/ directory not found at ${agentSrc}`);
    process.exit(1);
  }

  try {
    // Copy agents
    const agentCount = copyRecursive(agentSrc, AGENTS_DIR);
    console.log(`[${PACKAGE_NAME}] Installed ${agentCount} agent files to:`);
    console.log(`  ${AGENTS_DIR}`);
    console.log();

    // Copy skills
    const skillCount = copySkills();
    if (skillCount > 0) {
      console.log(`[${PACKAGE_NAME}] Installed ${skillCount} skill files to:`);
      console.log(`  ${SKILLS_DIR}`);
      console.log();
    }

    // Next steps
    console.log(`  Next step: add the agent path to your opencode.json or AGENTS.md:`);
    console.log(`  { "agents": [{ "path": "${AGENTS_DIR.replace(/\\/g, '\\\\')}" }] }`);
    console.log();
    console.log(`  Skills are auto-discovered — no config needed.`);
    console.log();
    console.log(`  Or run:  swe-pro-agents setup`);
  } catch (err) {
    console.error(`[${PACKAGE_NAME}] Install failed:`, err.message);
    process.exit(1);
  }
}

main();
