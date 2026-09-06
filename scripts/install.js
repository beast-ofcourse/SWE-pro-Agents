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
 * COMPONENT SELECTION: users pick exactly which agents, skills, and systems
 * (background tools, goal system) to install. Sources in precedence order:
 * SWE_PRO_AGENTS_SELECT env (JSON, from `swe-pro-agents setup`), the previous
 * manifest (reinstalls preserve the pick; brand-new pack files auto-install,
 * deselected ones stay out and get pruned), an interactive picker (first
 * install on a TTY only — "Customize? [y/N]", default no), else everything
 * with the goal on (all non-interactive/CI runs). A deselected goal system
 * writes { features: { goal: false } } to the global config beside the
 * manifest; an explicit project-level flag always wins over it. Reselect
 * anytime with `swe-pro-agents setup --select`.
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
// OpenCode's global plugin dir — doc-verified in plugins/swe-pro-agents.js header:
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
const packConfig = require('./pack-config.js');
const installSelect = require('./install-select.js');

// Selection from `swe-pro-agents setup` (JSON) — when present the install is
// non-interactive and applies exactly this pick. Shape:
// {"agents":[...]|"all"|"none", "skills":..., "background":bool, "goal":bool}
// Keys may be omitted (setup fills them); unknown names fail loudly.
const SELECT_ENV = 'SWE_PRO_AGENTS_SELECT';

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
 * Plugin file names the pack ships (basenames in PLUGIN_DIR).
 *  - plugins/swe-pro-agents.js — the single self-contained OpenCode plugin.
 *    It merges what were four installed plugins (goal/continuation nudge +
 *    background-subagent delegation) into one file. It is self-contained on
 *    purpose: OpenCode loads plugins from ~/.config/opencode/plugins/ and a
 *    plugin there can only require sibling files, never ../scripts, so the
 *    deep logic (LoopGate, delegation engine, worktree manager, feature-flag
 *    reader) is inlined — no cross-file requires, no duplicated sibling copies.
 *    scripts/loop-gate.js and scripts/pack-config.js are the CLI's own copies
 *    of that same logic (consumed by scripts/ledger.js and bin/), kept separate
 *    because the plugin cannot reach into ../scripts.
 */
function listPackPlugins() {
  return ['swe-pro-agents.js'];
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

function writeManifest(agents, skills, plugins, extra) {
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
    // Pack universe + system picks at install time. Lets later runs tell
    // brand-new pack files (auto-installed — never deselected) apart from
    // user-deselected ones (stay out until reselected). Older manifests lack
    // these keys; readers must tolerate their absence.
    packAgents: extra && Array.isArray(extra.packAgents) ? extra.packAgents : undefined,
    packSkills: extra && Array.isArray(extra.packSkills) ? extra.packSkills : undefined,
    systems: extra && extra.systems ? extra.systems : undefined,
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

function copySkills(names) {
  const src = path.join(pkgDir(), 'skills');
  if (!fs.existsSync(src)) return 0;
  let count = 0;
  for (const name of names) {
    if (!name || name === '.' || name === '..') continue;
    if (name.includes('/') || name.includes('\\')) continue;
    const skillSrc = path.join(src, name);
    if (!fs.existsSync(path.join(skillSrc, 'SKILL.md'))) continue;
    count += copyRecursive(skillSrc, path.join(SKILLS_DIR, name));
  }
  return count;
}

/** Copies exactly the given agent files (basenames, .md) into AGENTS_DIR. */
function copyAgents(files) {
  const src = path.join(pkgDir(), 'agents');
  let count = 0;
  for (const file of files) {
    if (!file || file === '.' || file === '..') continue;
    if (file.includes('/') || file.includes('\\')) continue;
    if (!file.endsWith('.md') || file === 'AGENTS.md') continue;
    const srcPath = path.join(src, file);
    if (!fs.existsSync(srcPath)) continue;
    fs.mkdirSync(AGENTS_DIR, { recursive: true });
    fs.copyFileSync(srcPath, path.join(AGENTS_DIR, file));
    count++;
  }
  return count;
}

/** Copies the pack's single plugin file into OpenCode's global plugin dir. */
function copyPlugins() {
  const src = path.join(pkgDir(), 'plugins', 'swe-pro-agents.js');
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(PLUGIN_DIR, { recursive: true });
  fs.copyFileSync(src, path.join(PLUGIN_DIR, 'swe-pro-agents.js'));
  return 1;
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

/**
 * Determine exactly what to install.
 *
 * Sources, in precedence order:
 *   1. SWE_PRO_AGENTS_SELECT env (JSON from `swe-pro-agents setup`) — keys it
 *      names win; keys it omits fall through to (2)/(3).
 *   2. Previous manifest — reinstalls preserve the user's pick: installed
 *      names intersected with the current pack, PLUS pack files added since
 *      that install (tracked via manifest.packAgents/packSkills — never
 *      deselected, so auto-included). Manifests predating universe tracking
 *      cannot distinguish new from deselected: those stay out until reselected.
 *   3. Interactive prompt — first install on a TTY only
 *      ("Customize the install? [y/N]", default no).
 *   4. Defaults — everything, goal on (historic behavior; all non-interactive
 *      and CI runs land here).
 *
 * Manual edits to the global goal file are sticky: when no explicit goal
 * value is given, the current on-disk global value wins over the manifest.
 */
function determineSelection(packAgents, packSkills, previous) {
  const envRaw = process.env[SELECT_ENV];
  let explicit = {};
  if (envRaw) {
    try {
      const parsed = JSON.parse(envRaw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('must be a JSON object');
      }
      explicit = parsed;
    } catch (err) {
      console.error(`[${PACKAGE_NAME}] ERROR: ${SELECT_ENV} is not valid JSON: ${err.message}`);
      process.exit(1);
    }
  }
  let resolved = { agents: null, skills: null, background: null, goal: null };
  try {
    resolved = installSelect.resolveSelection(explicit, { agents: packAgents, skills: packSkills });
  } catch (err) {
    console.error(`[${PACKAGE_NAME}] ERROR: bad selection: ${err.message}`);
    process.exit(1);
  }

  const intersect = (names, pack) => (names || []).filter((n) => pack.includes(n));
  const addedSince = (pack, universe) => {
    if (!Array.isArray(universe)) return [];
    return pack.filter((n) => !universe.includes(n));
  };

  let agents;
  let skills;
  let addedAgents = [];
  let addedSkills = [];
  if (resolved.agents !== null) {
    agents = resolved.agents;
  } else if (previous) {
    agents = [...new Set([...intersect(previous.agents, packAgents), ...addedSince(packAgents, previous.packAgents)])];
  } else {
    agents = [...packAgents];
  }
  if (resolved.skills !== null) {
    skills = resolved.skills;
  } else if (previous) {
    skills = [...new Set([...intersect(previous.skills, packSkills), ...addedSince(packSkills, previous.packSkills)])];
  } else {
    skills = [...packSkills];
  }
  if (previous && previous.packAgents) {
    addedAgents = addedSince(packAgents, previous.packAgents);
  }
  if (previous && previous.packSkills) {
    addedSkills = addedSince(packSkills, previous.packSkills);
  }

  let background;
  let goal;
  if (resolved.background !== null) {
    background = resolved.background;
  } else if (previous && previous.systems && typeof previous.systems.background === 'boolean') {
    background = previous.systems.background;
  } else {
    background = true;
  }
  if (resolved.goal !== null) {
    goal = resolved.goal;
  } else {
    const onDisk = packConfig.readGoalValue(packConfig.globalConfigPath());
    if (onDisk !== undefined) {
      goal = onDisk;
    } else if (previous && previous.systems && typeof previous.systems.goal === 'boolean') {
      goal = previous.systems.goal;
    } else {
      goal = true;
    }
  }
  return { agents, skills, background, goal, addedAgents, addedSkills };
}

async function main() {
  const agentSrc = path.join(pkgDir(), 'agents');

  if (!fs.existsSync(agentSrc)) {
    console.error(`[${PACKAGE_NAME}] ERROR: agents/ directory not found at ${agentSrc}`);
    process.exit(1);
  }

  try {
    const previous = readManifest();
    const packAgents = listPackAgents();
    const packSkills = listPackSkills();
    const packPlugins = listPackPlugins();

    let sel = determineSelection(packAgents, packSkills, previous);

    // First install on an interactive terminal: offer the component picker.
    // Default (empty answer) installs everything — historic behavior.
    // Upgrades never prompt: the preserved pick applies silently.
    if (!previous && !process.env[SELECT_ENV] && installSelect.shouldPrompt()) {
      const customize = await installSelect.promptYesNo(
        `[${PACKAGE_NAME}] Customize the install (choose agents/skills/systems)?`,
        false
      );
      if (customize) {
        const picked = await installSelect.promptSelection();
        sel = {
          agents: picked.agents,
          skills: picked.skills,
          background: picked.background,
          goal: picked.goal,
          addedAgents: [],
          addedSkills: [],
        };
      }
    }

    const selPlugins = sel.background || sel.goal ? [...packPlugins] : [];

    if (previous) {
      // Prune against the SELECTED sets (not the full pack): deselected
      // components leave the machine on reinstall.
      prune(previous.agents, sel.agents, AGENTS_DIR, 'agent');
      prune(previous.skills, sel.skills, SKILLS_DIR, 'skill');
      prune(previous.plugins, selPlugins, PLUGIN_DIR, 'plugin', 'swe-pro-agents');
    } else {
      console.log(`[${PACKAGE_NAME}] No manifest found — first install or upgrade`);
      console.log(`  from a pre-manifest version; nothing pruned.`);
    }

    // Copy agents (selected files only)
    const agentCount = copyAgents(sel.agents);
    console.log(`[${PACKAGE_NAME}] Installed ${agentCount} agent files to:`);
    console.log(`  ${AGENTS_DIR}`);
    console.log();

    // Copy skills (selected directories only)
    const skillCount = copySkills(sel.skills);
    if (skillCount > 0) {
      console.log(`[${PACKAGE_NAME}] Installed ${skillCount} skill files to:`);
      console.log(`  ${SKILLS_DIR}`);
      console.log();
    } else {
      console.log(`[${PACKAGE_NAME}] No skills selected — skipping.`);
      console.log();
    }

    // Copy plugins (only when background tools or goal system is selected)
    let pluginCount = 0;
    if (selPlugins.length > 0) {
      pluginCount = copyPlugins();
    }
    if (pluginCount > 0) {
      console.log(`[${PACKAGE_NAME}] Installed ${pluginCount} plugin files to:`);
      console.log(`  ${PLUGIN_DIR}`);
      console.log();
    } else {
      console.log(`[${PACKAGE_NAME}] Plugin not installed (background tools and goal system deselected).`);
      console.log();
    }

    // Global goal flag: records an explicit pick; a manual on-disk edit is
    // sticky (determineSelection reads it back). Skipped when the outcome is
    // the default with no file yet — keeps fresh machines clean.
    const globalPath = packConfig.globalConfigPath();
    const globalExists = globalPath && fs.existsSync(globalPath);
    if (!sel.goal || globalExists) {
      packConfig.writeGlobalConfig({ goal: sel.goal });
      console.log(`[${PACKAGE_NAME}] Goal system (/goal + idle nudges): ${sel.goal ? 'enabled' : 'disabled'} (global).`);
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

    // Record exactly what we installed, so update can prune and uninstall can clean up.
    // The manifest also stores the pack universe + system picks so later runs
    // preserve deselections while auto-including brand-new pack files.
    writeManifest(sel.agents, sel.skills, selPlugins, {
      packAgents,
      packSkills,
      systems: { background: sel.background, goal: sel.goal },
    });
    console.log(`[${PACKAGE_NAME}] Manifest updated: ${MANIFEST_PATH}`);
    console.log();

    const newItems = [...sel.addedAgents, ...sel.addedSkills];
    if (previous && newItems.length > 0) {
      console.log(`  New in this pack version (installed — never deselected):`);
      for (const name of newItems) console.log(`    + ${name}`);
      console.log();
    }

    // Next steps
    console.log(`  Next step: add the agent path to your opencode.json:`);
    console.log(`  { "agents": [{ "path": "${AGENTS_DIR.replace(/\\/g, '\\\\')}" }] }`);
    console.log();
    console.log(`  Or run:  swe-pro-agents setup --apply`);
    console.log(`  Reselect components anytime:  swe-pro-agents setup --select`);
    console.log();
    console.log(`  Skills are auto-discovered — no config needed.`);
    console.log();
  } catch (err) {
    console.error(`[${PACKAGE_NAME}] Install failed:`, err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`[${PACKAGE_NAME}] Install failed:`, err && err.message ? err.message : err);
  process.exit(1);
});
