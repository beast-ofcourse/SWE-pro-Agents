#!/usr/bin/env node

/**
 * postinstall — copies agent files to ~/.config/opencode/agents/swe-pro-agents/,
 *                skill files to ~/.config/opencode/skills/, plugin files to
 *                ~/.config/opencode/plugins/, and this pack's AGENTS.md (the
 *                shared foundation every lean agent file in agents/ depends on
 *                — Core priorities, Engineering rules, Completion checklist,
 *                Reporting format) to the pack's own config dir
 *                (~/.config/swe-pro-agents/).
 *
 *                AGENTS.md must NEVER be placed inside the agents directory:
 *                OpenCode loads every .md file in a registered agents path as
 *                an agent profile, so an AGENTS.md there shows up as a phantom
 *                "AGENTS" agent. The pack's copy lives outside that path and
 *                the user is told to copy/merge it into their global
 *                ~/.config/opencode/AGENTS.md.
 *
 * Runs automatically after `npm install -g swe-pro-agents`.
 *
 * LIFECYCLE: this installer keeps a manifest at
 * ~/.config/swe-pro-agents/manifest.json recording exactly what it installed
 * (agent files, skill directories, plugin files, destination paths). On every
 * run it:
 *   1. prunes previously installed agents/skills/plugins the pack no longer
 *      ships (updating never leaves stale files behind), and
 *   2. rewrites the manifest so uninstall.js can remove exactly what the pack
 *      owns — nothing more, nothing less.
 * If no manifest exists (first install, or an upgrade from a pre-manifest
 * version), nothing is pruned — the installer never guesses ownership.
 *
 * User still needs to add the agent path to their opencode.json, and merge in
 * (or point OpenCode at) the shipped AGENTS.md once. `swe-pro-agents setup`
 * prints the config snippet; `swe-pro-agents setup --apply` writes it.
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
// OpenCode's global plugin dir — doc-verified in plugins/continuation.js header:
// https://opencode.ai/docs/plugins/ ("Use a plugin — From local files"); loader
// scan glob `{plugin,plugins}/*.{ts,js}` confirmed in
// packages/opencode/src/config/plugin.ts.
const PLUGIN_DIR = path.join(os.homedir(), '.config', 'opencode', 'plugins');
const GLOBAL_AGENTS_MD = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
const MANIFEST_DIR = path.join(os.homedir(), '.config', 'swe-pro-agents');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'manifest.json');
// The pack's AGENTS.md copy — deliberately OUTSIDE the agents dir (see header).
const PACK_AGENTS_MD_DEST = path.join(MANIFEST_DIR, 'AGENTS.md');
// Legacy location from versions <= 2.5.x: inside the agents dir, where OpenCode
// loaded it as a phantom agent. Removed on install (see installAgentsMd).
const LEGACY_AGENTS_MD = path.join(AGENTS_DIR, 'AGENTS.md');

const pkg = require(path.join(__dirname, '..', 'package.json'));

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

/** Agent file names the pack ships (excludes AGENTS.md — handled separately). */
function listPackAgents() {
  const src = path.join(pkgDir(), 'agents');
  return fs.readdirSync(src).filter(f => f.endsWith('.md') && f !== 'AGENTS.md');
}

/** Skill directory names the pack ships (a directory with a SKILL.md). */
function listPackSkills() {
  const src = path.join(pkgDir(), 'skills');
  if (!fs.existsSync(src)) return [];
  return fs.readdirSync(src, { withFileTypes: true })
    .filter(e => e.isDirectory() && fs.existsSync(path.join(src, e.name, 'SKILL.md')))
    .map(e => e.name);
}

/**
 * Plugin file names the pack ships (basenames in PLUGIN_DIR). Sources live in
 * two places — plugins/continuation.js and scripts/loop-logic.js — so the
 * installed names are explicit rather than derived from one directory.
 */
function listPackPlugins() {
  return ['swe-pro-agents-continuation.js', 'swe-pro-agents-loop-logic.js'];
}

/** Tolerant manifest read — a missing or corrupt manifest means "no ownership info". */
function readManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.agents) && Array.isArray(data.skills)) {
      return data;
    }
  } catch { /* fall through */ }
  return null;
}

function writeManifest(agents, skills, plugins) {
  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  const manifest = {
    packageVersion: pkg.version,
    installedAt: new Date().toISOString(),
    paths: {
      agentsDir: AGENTS_DIR,
      skillsDir: SKILLS_DIR,
      pluginsDir: PLUGIN_DIR,
      agentsMd: PACK_AGENTS_MD_DEST,
    },
    agents,
    skills,
    plugins,
  };
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
}

/**
 * Deletes previously installed entries the pack no longer ships.
 * Only exact-name children of baseDir are ever touched (defense in depth —
 * names come from our own manifest, but never trust paths blindly). When a
 * `prefix` is given, only names starting with it are pruned — used for the
 * shared plugin dir, where non-prefixed user files must never be touched.
 */
function prune(previousNames, currentNames, baseDir, kind, prefix) {
  if (!previousNames) return 0;
  const stale = previousNames.filter(name => !currentNames.includes(name));
  let removed = 0;

  for (const name of stale) {
    if (!name || name === '.' || name === '..') continue;
    if (name.includes('/') || name.includes('\\')) continue;
    if (prefix && !name.startsWith(prefix)) continue;
    const target = path.join(baseDir, name);
    if (path.dirname(target) !== path.normalize(baseDir)) continue;
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
      removed++;
      console.log(`  Pruned stale ${kind}: ${name}`);
    }
  }

  return removed;
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

/** Copies the pack's plugin files into OpenCode's global plugin dir. */
function copyPlugins() {
  const sources = [
    { name: 'swe-pro-agents-continuation.js', src: path.join(pkgDir(), 'plugins', 'continuation.js') },
    { name: 'swe-pro-agents-loop-logic.js', src: path.join(pkgDir(), 'scripts', 'loop-logic.js') },
  ];
  let count = 0;
  for (const { name, src } of sources) {
    if (!fs.existsSync(src)) continue;
    fs.mkdirSync(PLUGIN_DIR, { recursive: true });
    fs.copyFileSync(src, path.join(PLUGIN_DIR, name));
    count++;
  }
  return count;
}

// Copies this pack's AGENTS.md to the pack's own config dir (never the agents
// dir — OpenCode would load it as an agent), and separately reports whether
// the user has a *global* AGENTS.md already — since every lean agent in
// agents/ assumes something like this pack's AGENTS.md is loaded into
// context, and silently having none is worse than the agents relying on
// content that was never installed.
function installAgentsMd() {
  const src = path.join(pkgDir(), 'AGENTS.md');
  if (!fs.existsSync(src)) {
    return { copied: false, globalExists: false, legacyRemoved: false };
  }

  fs.mkdirSync(MANIFEST_DIR, { recursive: true });
  fs.copyFileSync(src, PACK_AGENTS_MD_DEST);

  // Clean up the legacy copy inside the agents dir (<= 2.5.x behavior) — it
  // was pack-owned by contract, and leaving it would keep the phantom agent.
  let legacyRemoved = false;
  if (fs.existsSync(LEGACY_AGENTS_MD)) {
    fs.rmSync(LEGACY_AGENTS_MD, { force: true });
    legacyRemoved = true;
  }

  const globalExists = fs.existsSync(GLOBAL_AGENTS_MD);
  return { copied: true, globalExists, legacyRemoved };
}

function main() {
  const agentSrc = path.join(pkgDir(), 'agents');

  if (!fs.existsSync(agentSrc)) {
    console.error(`[${PACKAGE_NAME}] ERROR: agents/ directory not found at ${agentSrc}`);
    process.exit(1);
  }

  try {
    const previous = readManifest();
    const newAgents = listPackAgents();
    const newSkills = listPackSkills();
    const newPlugins = listPackPlugins();

    if (previous) {
      prune(previous.agents, newAgents, AGENTS_DIR, 'agent');
      prune(previous.skills, newSkills, SKILLS_DIR, 'skill');
      prune(previous.plugins, newPlugins, PLUGIN_DIR, 'plugin', 'swe-pro-agents-');
    } else {
      console.log(`[${PACKAGE_NAME}] No manifest found — first install or upgrade`);
      console.log(`  from a pre-manifest version; nothing pruned.`);
    }

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

    // Copy plugins
    const pluginCount = copyPlugins();
    if (pluginCount > 0) {
      console.log(`[${PACKAGE_NAME}] Installed ${pluginCount} plugin files to:`);
      console.log(`  ${PLUGIN_DIR}`);
      console.log();
    }

    // Copy this pack's AGENTS.md (shared foundation for every agent in agents/)
    const agentsMdResult = installAgentsMd();
    if (agentsMdResult.copied) {
      console.log(`[${PACKAGE_NAME}] Installed this pack's AGENTS.md (shared`);
      console.log(`  Engineering Operating System — Core priorities, Engineering`);
      console.log(`  rules, Completion checklist, Reporting format — that`);
      console.log(`  every agent in this pack assumes is loaded) to:`);
      console.log(`  ${PACK_AGENTS_MD_DEST}`);
      if (agentsMdResult.legacyRemoved) {
        console.log(`  Removed the legacy copy from the agents dir (it was being`);
        console.log(`  loaded as a phantom agent): ${LEGACY_AGENTS_MD}`);
      }
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
        console.log(`  Without one, these agents lose their shared Engineering`);
        console.log(`  Operating System — copy the file`);
        console.log(`  above to that path (or your project's AGENTS.md) so`);
        console.log(`  OpenCode loads it automatically:`);
        console.log(`    cp "${PACK_AGENTS_MD_DEST}" "${GLOBAL_AGENTS_MD}"`);
      }
      console.log();
    }

    // Record exactly what we installed, so update can prune and uninstall can clean up
    writeManifest(newAgents, newSkills, newPlugins);
    console.log(`[${PACKAGE_NAME}] Manifest updated: ${MANIFEST_PATH}`);
    console.log();

    // Next steps
    console.log(`  Next step: add the agent path to your opencode.json:`);
    console.log(`  { "agents": [{ "path": "${AGENTS_DIR.replace(/\\/g, '\\\\')}" }] }`);
    console.log();
    console.log(`  Or run:  swe-pro-agents setup --apply`);
    console.log();
    console.log(`  Skills are auto-discovered — no config needed.`);
    console.log();
  } catch (err) {
    console.error(`[${PACKAGE_NAME}] Install failed:`, err.message);
    process.exit(1);
  }
}

main();
