#!/usr/bin/env node

/**
 * preuninstall — removes everything this pack installed, and only that.
 *
 * Runs automatically before `npm uninstall -g swe-pro-agents`.
 *
 * Uses the manifest written by install.js (~/.config/swe-pro-agents/manifest.json):
 *   1. removes the package-scoped agents directory,
 *   2. removes exactly the skill directories the manifest records as
 *      pack-owned (user skills in the shared skills dir are never touched),
 *   3. removes the manifest dir — including the pack's own AGENTS.md copy,
 *      which lives there (never inside the agents dir, where OpenCode would
 *      load it as an agent).
 *
 * If no manifest is found, the agents directory is still removed (it is
 * package-scoped by contract) and the user is told that pack skills could not
 * be determined automatically.
 *
 * What is NOT touched — deliberately, because it is user-owned content:
 *   - the opencode.json entry referencing the agents path,
 *   - any AGENTS.md content the user merged into their global config.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const TARGET_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);
const SKILLS_DIR = path.join(os.homedir(), '.config', 'opencode', 'skills');
const MANIFEST_DIR = path.join(os.homedir(), '.config', 'swe-pro-agents');
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'manifest.json');

/** Tolerant manifest read — a missing or corrupt manifest means "no ownership info". */
function readManifest() {
  try {
    const raw = fs.readFileSync(MANIFEST_PATH, 'utf-8');
    const data = JSON.parse(raw);
    if (data && Array.isArray(data.skills)) {
      return data;
    }
  } catch { /* fall through */ }
  return null;
}

function main() {
  const manifest = readManifest();
  let removedAnything = false;

  // 1. Agents directory — package-scoped by path, safe to remove wholesale.
  if (fs.existsSync(TARGET_DIR)) {
    fs.rmSync(TARGET_DIR, { recursive: true, force: true });
    console.log(`[${PACKAGE_NAME}] Removed agent files from:`);
    console.log(`  ${TARGET_DIR}`);
    removedAnything = true;
  }

  // 2. Pack-owned skills — only exact-name children of the shared skills dir,
  //    and only names recorded in our own manifest. User skills survive.
  if (manifest) {
    for (const name of manifest.skills) {
      if (!name || name === '.' || name === '..') continue;
      if (name.includes('/') || name.includes('\\')) continue;
      const target = path.join(SKILLS_DIR, name);
      if (path.dirname(target) !== path.normalize(SKILLS_DIR)) continue;
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
        console.log(`  Removed skill: ${name}`);
        removedAnything = true;
      }
    }
  } else {
    console.log(`  No manifest found — could not determine which skills this pack`);
    console.log(`  owns, so nothing was removed from ${SKILLS_DIR}.`);
    console.log(`  If this pack's skills are still there, remove them manually.`);
  }

  // 3. Manifest itself.
  if (fs.existsSync(MANIFEST_DIR)) {
    fs.rmSync(MANIFEST_DIR, { recursive: true, force: true });
    console.log(`  Removed manifest: ${MANIFEST_DIR}`);
    removedAnything = true;
  }

  if (!removedAnything) {
    console.log(`[${PACKAGE_NAME}] Nothing installed by this pack was found.`);
  }

  console.log();
  console.log(`  Note: your opencode.json still references the agents path — remove that`);
  console.log(`  entry manually. If you merged this pack's AGENTS.md content into`);
  console.log(`  your global ~/.config/opencode/AGENTS.md, that merge is untouched;`);
  console.log(`  edit it yourself if you want those sections removed too.`);
}

main();
