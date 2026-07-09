#!/usr/bin/env node

/**
 * postinstall — copies agent files to ~/.config/opencode/agents/swe-pro-agents/,
 *                skill files to ~/.config/opencode/skills/, and this pack's
 *                AGENTS.md (the shared foundation every lean agent file in
 *                agents/ depends on for its Constitution, Definition of Done,
 *                and Handoff protocol) to a package-scoped location.
 *
 * Runs automatically after `npm install -g swe-pro-agents`.
 * User still needs to add the agent path to their opencode.json, and merge in
 * (or point OpenCode at) the shipped AGENTS.md once.
 * Skills are auto-discovered by OpenCode once placed in ~/.config/opencode/skills/.
 *
 * IMPORTANT: this pack's AGENTS.md is never written directly to
 * ~/.config/opencode/AGENTS.md or a project's AGENTS.md — that file may
 * already exist with the user's own project rules, and silently overwriting
 * it would destroy their content. Instead it's copied to a package-scoped
 * path and the user is told exactly how to merge or reference it.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const AGENTS_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);
const SKILLS_DIR = path.join(os.homedir(), '.config', 'opencode', 'skills');
const PACK_AGENTS_MD_DEST = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME, 'AGENTS.md');
const GLOBAL_AGENTS_MD = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');

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

// Copies this pack's AGENTS.md to a package-scoped path so it's always
// available, and separately reports whether the user has a *global*
// AGENTS.md already — since every lean agent in agents/ assumes something
// like this pack's AGENTS.md is loaded into context, and silently having
// none is worse than the agents relying on content that was never installed.
function installAgentsMd() {
  const src = path.join(pkgDir(), 'AGENTS.md');
  if (!fs.existsSync(src)) {
    return { copied: false, globalExists: false };
  }

  fs.copyFileSync(src, PACK_AGENTS_MD_DEST);
  const globalExists = fs.existsSync(GLOBAL_AGENTS_MD);
  return { copied: true, globalExists };
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

    // Copy this pack's AGENTS.md (shared foundation for every agent in agents/)
    const agentsMdResult = installAgentsMd();
    if (agentsMdResult.copied) {
      console.log(`[${PACKAGE_NAME}] Installed this pack's AGENTS.md (shared`);
      console.log(`  Constitution, Definition of Done, and Handoff protocol that`);
      console.log(`  every agent in this pack assumes is loaded) to:`);
      console.log(`  ${PACK_AGENTS_MD_DEST}`);
      console.log();
      if (agentsMdResult.globalExists) {
        console.log(`  You already have a global AGENTS.md at:`);
        console.log(`  ${GLOBAL_AGENTS_MD}`);
        console.log(`  This was NOT overwritten. Merge the sections you want from`);
        console.log(`  the copy above into it, or add this to your project's`);
        console.log(`  AGENTS.md so it gets pulled in for these agents specifically:`);
        console.log(`    See: @${PACK_AGENTS_MD_DEST}`);
      } else {
        console.log(`  No global AGENTS.md was found at ${GLOBAL_AGENTS_MD}.`);
        console.log(`  Without one, these agents lose their shared Constitution,`);
        console.log(`  Definition of Done, and Handoff protocol — copy the file`);
        console.log(`  above to that path (or your project's AGENTS.md) so`);
        console.log(`  OpenCode loads it automatically:`);
        console.log(`    cp "${PACK_AGENTS_MD_DEST}" "${GLOBAL_AGENTS_MD}"`);
      }
      console.log();
    }

    // Next steps
    console.log(`  Next step: add the agent path to your opencode.json:`);
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
