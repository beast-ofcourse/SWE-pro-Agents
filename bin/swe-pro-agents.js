#!/usr/bin/env node

/**
 * CLI for managing SWE Pro Agents installation.
 *
 * Usage:
 *   swe-pro-agents setup [--apply]   — Show the opencode.json config snippet
 *                                      (--apply writes it, with a .bak backup)
 *   swe-pro-agents status            — Show installation status + update check
 *   swe-pro-agents version           — Show version
 *   swe-pro-agents help              — Show this help
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const SKILLS_DIR = path.join(__dirname, '..', 'skills');
const TARGET_AGENTS_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);
const TARGET_SKILLS_DIR = path.join(os.homedir(), '.config', 'opencode', 'skills');
const PACK_AGENTS_MD = path.join(os.homedir(), '.config', 'swe-pro-agents', 'AGENTS.md');
const GLOBAL_AGENTS_MD = path.join(os.homedir(), '.config', 'opencode', 'AGENTS.md');
const OPENCODE_CONFIG = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');

const pkg = require(path.join(__dirname, '..', 'package.json'));

/** The agent path written into opencode.json (forward slashes — valid JSON on every OS). */
function configEntryPath() {
  return TARGET_AGENTS_DIR.replace(/\\/g, '/');
}

function getAgentCount() {
  if (!fs.existsSync(AGENTS_DIR)) return 0;
  return fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).length;
}

function getSkillCount() {
  if (!fs.existsSync(SKILLS_DIR)) return 0;
  return fs.readdirSync(SKILLS_DIR).filter(e =>
    fs.statSync(path.join(SKILLS_DIR, e)).isDirectory()
      && fs.existsSync(path.join(SKILLS_DIR, e, 'SKILL.md'))
  ).length;
}

function getInstalledAgentCount() {
  if (!fs.existsSync(TARGET_AGENTS_DIR)) return 0;
  // AGENTS.md lives in the pack's config dir, not here (see installAgentsMd in
  // install.js) — but a legacy copy from <= 2.5.x may linger; it's shared
  // foundation, not an agent, so exclude it.
  return fs.readdirSync(TARGET_AGENTS_DIR).filter(f => f.endsWith('.md') && f !== 'AGENTS.md').length;
}

function semverGt(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

/**
 * Checks the npm registry for a newer version. Never throws and never blocks
 * status output for long — offline or slow registries just skip the check.
 * Fetches the registry directly (no child process) so it's also immune to
 * npm's local packument cache.
 */
function checkForUpdates() {
  return new Promise(resolve => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);

    fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, { signal: controller.signal })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        clearTimeout(timer);
        const latest = data && data.version;
        if (!latest || !semverGt(latest, pkg.version)) return resolve(null);
        resolve(latest);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

function applyToOpenCodeConfig() {
  let config = {};
  let existed = false;

  if (fs.existsSync(OPENCODE_CONFIG)) {
    existed = true;
    try {
      const raw = fs.readFileSync(OPENCODE_CONFIG, 'utf-8').replace(/^\uFEFF/, '');
      config = JSON.parse(raw);
    } catch (err) {
      console.log(`  ERROR: could not parse ${OPENCODE_CONFIG}: ${err.message}`);
      console.log(`  Nothing was changed. Add the entry manually:`);
      console.log(`    { "agents": [{ "path": "${configEntryPath()}" }] }`);
      return;
    }
  }

  if (!config.agents) config.agents = [];
  if (config.agents.some(a => String((a && a.path) || '').includes(PACKAGE_NAME))) {
    console.log(`  opencode.json already references ${PACKAGE_NAME} — nothing to change.`);
    return;
  }

  if (existed) {
    fs.copyFileSync(OPENCODE_CONFIG, OPENCODE_CONFIG + '.bak');
    console.log(`  Backup written to ${OPENCODE_CONFIG}.bak`);
  }

  config.agents.push({ path: configEntryPath() });
  fs.writeFileSync(OPENCODE_CONFIG, JSON.stringify(config, null, 2) + '\n');
  console.log(`  Added agent path to ${OPENCODE_CONFIG}`);
  console.log(`  Restart OpenCode to load the agents.`);
}

function cmdSetup() {
  console.log(`\n  Add this to your opencode.json:\n`);
  console.log(`  {`);
  console.log(`    "agents": [{ "path": "${configEntryPath()}" }]`);
  console.log(`  }\n`);
  console.log(`  Or apply it automatically (backs up your config first):`);
  console.log(`    swe-pro-agents setup --apply\n`);
  console.log(`  Skills are auto-discovered from ~/.config/opencode/skills/ — no config needed.\n`);

  const globalExists = fs.existsSync(GLOBAL_AGENTS_MD);
  const packAgentsMdExists = fs.existsSync(PACK_AGENTS_MD);
  console.log(`  This pack's agents/ files are intentionally short — they rely on`);
  console.log(`  a shared AGENTS.md (Engineering Operating System: Core priorities,`);
  console.log(`  Engineering rules, Completion checklist, Reporting format) being`);
  console.log(`  loaded into context for every agent.\n`);
  if (!packAgentsMdExists) {
    console.log(`  Warning: the pack's AGENTS.md wasn't found at ${PACK_AGENTS_MD}.`);
    console.log(`  Try reinstalling: npm update -g ${PACKAGE_NAME}\n`);
  } else if (globalExists) {
    console.log(`  You have a global AGENTS.md at ${GLOBAL_AGENTS_MD}.`);
    console.log(`  Merge in whatever you want from:\n  ${PACK_AGENTS_MD}\n`);
  } else {
    console.log(`  No global AGENTS.md found. Without one, these agents lose their`);
    console.log(`  shared foundation. Copy it into place:\n`);
    console.log(`    cp "${PACK_AGENTS_MD}" "${GLOBAL_AGENTS_MD}"\n`);
  }
}

function cmdStatus() {
  const agentCount = getAgentCount();
  const skillCount = getSkillCount();
  const installedAgentCount = getInstalledAgentCount();

  console.log(`\n  SWE Pro Agents — Status`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Version:    ${pkg.version}`);
  console.log(`  Agents:     ${agentCount} in package` + (installedAgentCount > 0 ? `, ${installedAgentCount} installed` : ''));
  console.log(`  Skills:     ${skillCount} in package`);

  if (installedAgentCount > 0 && installedAgentCount !== agentCount) {
    console.log(`  Warning: installed agent count (${installedAgentCount}) doesn't match package (${agentCount}). Run 'npm update -g swe-pro-agents'.`);
  }

  // Check if opencode.json references these agents
  const opencodeConfigPath = OPENCODE_CONFIG;
  if (fs.existsSync(opencodeConfigPath)) {
    try {
      const raw = fs.readFileSync(opencodeConfigPath, 'utf-8').replace(/^\uFEFF/, '');
      const config = JSON.parse(raw);
      const agents = config.agents || [];
      const referenced = agents.some(a => (a.path || '').includes(PACKAGE_NAME));
      console.log(`  Config:     ${referenced ? 'Referenced in opencode.json' : 'Not yet added to opencode.json (run: swe-pro-agents setup --apply)'}`);
    } catch {
      console.log(`  Config:     opencode.json found but could not parse`);
    }
  } else {
    console.log(`  Config:     No opencode.json found (run: swe-pro-agents setup --apply)`);
  }

  // Check AGENTS.md — the shared foundation every agent file assumes is loaded
  const packAgentsMdExists = fs.existsSync(PACK_AGENTS_MD);
  const globalAgentsMdExists = fs.existsSync(GLOBAL_AGENTS_MD);
  console.log(`  AGENTS.md:  ${packAgentsMdExists ? 'Installed (package copy present)' : 'MISSING — run npm update'}`);
  if (packAgentsMdExists && !globalAgentsMdExists) {
    console.log(`              Warning: no global AGENTS.md found — agents are missing`);
    console.log(`              their shared Engineering Operating System. Run 'swe-pro-agents setup'.`);
  }

  console.log();
}

function cmdVersion() {
  console.log(pkg.version);
}

function cmdHelp() {
  console.log(`\n  SWE Pro Agents v${pkg.version}`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Usage: swe-pro-agents <command>\n`);
  console.log(`  Commands:`);
  console.log(`    setup [--apply]  Show the opencode.json config snippet;`);
  console.log(`                     --apply writes it (with a .bak backup)`);
  console.log(`    status           Show installation status + update check`);
  console.log(`    version          Show package version`);
  console.log(`    help             Show this help\n`);
}

async function main() {
  const cmd = process.argv[2] || 'help';

  switch (cmd) {
    case 'setup':
      cmdSetup();
      if (process.argv.includes('--apply')) {
        console.log(`  Applying opencode.json entry...`);
        applyToOpenCodeConfig();
      }
      break;
    case 'status':
      cmdStatus();
      // Update check — offline/slow registries silently skip it.
      const latest = await checkForUpdates();
      if (latest) {
        console.log(`  Update:     ${latest} available (you have ${pkg.version}) —`);
        console.log(`              run 'npm update -g ${PACKAGE_NAME}'`);
        console.log();
      }
      break;
    case 'version':
    case '-v':
    case '--version':
      cmdVersion();
      break;
    case 'help':
    case '-h':
    case '--help':
    default:
      cmdHelp();
      break;
  }
}

main().catch(err => {
  console.error(`[${PACKAGE_NAME}] Error:`, err.message);
  process.exit(1);
});
