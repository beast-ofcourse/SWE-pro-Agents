#!/usr/bin/env node

/**
 * CLI for managing SWE Pro Agents installation.
 *
 * Usage:
 *   swe-pro-agents setup    — Show the opencode.json config snippet
 *   swe-pro-agents status   — Show installation status
 *   swe-pro-agents version  — Show version
 *   swe-pro-agents teams    — List available teams
 *   swe-pro-agents help     — Show this help
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const AGENTS_DIR = path.join(__dirname, '..', 'agents');
const TEAMS_DIR = path.join(__dirname, '..', 'teams');
const TARGET_DIR = path.join(os.homedir(), '.config', 'opencode', 'agents', PACKAGE_NAME);

const pkg = require(path.join(__dirname, '..', 'package.json'));

function getAgentCount() {
  if (!fs.existsSync(AGENTS_DIR)) return 0;
  return fs.readdirSync(AGENTS_DIR).filter(f => f.endsWith('.md')).length;
}

function getInstalledAgentCount() {
  if (!fs.existsSync(TARGET_DIR)) return 0;
  return fs.readdirSync(TARGET_DIR).filter(f => f.endsWith('.md')).length;
}

function listTeams() {
  if (!fs.existsSync(TEAMS_DIR)) return [];
  return fs.readdirSync(TEAMS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({
      name: d.name,
      agents: getTeamAgentCount(path.join(TEAMS_DIR, d.name)),
      path: path.join(TEAMS_DIR, d.name)
    }));
}

function getTeamAgentCount(teamPath) {
  const agentsDir = path.join(teamPath, '.opencode', 'agents');
  if (!fs.existsSync(agentsDir)) return 0;
  return fs.readdirSync(agentsDir).filter(f => f.endsWith('.md')).length;
}

function cmdTeams() {
  const teams = listTeams();

  if (teams.length === 0) {
    console.log(`\n  No teams bundled in this package.\n`);
    return;
  }

  console.log(`\n  SWE Pro Agents — Teams`);
  console.log(`  ${'─'.repeat(40)}`);

  for (const team of teams) {
    const primaryPath = path.join(team.path, '.opencode', 'agents');
    let primary = '(none)';
    if (fs.existsSync(primaryPath)) {
      const agents = fs.readdirSync(primaryPath).filter(f => f.endsWith('.md'));
      primary = agents.find(a => {
        const content = fs.readFileSync(path.join(primaryPath, a), 'utf-8');
        return content.includes('mode: primary');
      }) || agents[0] || '(none)';
    }
    console.log(`  ${team.name}`);
    console.log(`    Agents:   ${team.agents} (primary: ${primary.replace('.md', '')})`);
    console.log(`    Install:  ${path.join(TARGET_DIR, 'teams', team.name)}`);
    console.log();
  }
}

function cmdSetup() {
  console.log(`\n  Add this to your opencode.json:\n`);
  console.log(`  {`);
  console.log(`    "agents": [{ "path": "${TARGET_DIR.replace(/\\/g, '\\\\')}" }]`);
  console.log(`  }\n`);
  console.log(`  Or add this line to your AGENTS.md:\n`);
  console.log(`  - path: ${TARGET_DIR}\n`);
}

function cmdStatus() {
  const agentCount = getAgentCount();
  const installedCount = getInstalledAgentCount();
  const teams = listTeams();

  console.log(`\n  SWE Pro Agents — Status`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Version:    ${pkg.version}`);
  console.log(`  Package:    ${agentCount} individual agents`);
  if (teams.length > 0) {
    console.log(`  Teams:      ${teams.map(t => `${t.name} (${t.agents} agents)`).join(', ')}`);
  }
  console.log(`  Installed:  ${installedCount > 0 ? `${installedCount} files at ${TARGET_DIR}` : 'Not installed'}`);

  if (installedCount > 0 && teams.length > 0) {
    const teamsTarget = path.join(TARGET_DIR, 'teams');
    const installedTeams = fs.existsSync(teamsTarget) ? fs.readdirSync(teamsTarget).filter(f => {
      const p = path.join(teamsTarget, f);
      return fs.statSync(p).isDirectory();
    }) : [];
    if (installedTeams.length > 0) {
      console.log(`  Teams OK:   ${installedTeams.join(', ')}`);
    }
  }

  if (installedCount > 0 && installedCount < agentCount) {
    console.log(`  Warning: some files missing. Run 'npm update -g swe-pro-agents'.`);
  }

  // Check if opencode.json references these agents
  const opencodeConfigPath = path.join(os.homedir(), '.config', 'opencode', 'opencode.json');
  if (fs.existsSync(opencodeConfigPath)) {
    try {
      const raw = fs.readFileSync(opencodeConfigPath, 'utf-8').replace(/^\uFEFF/, '');
      const config = JSON.parse(raw);
      const agents = config.agents || [];
      const referenced = agents.some(a => (a.path || '').includes(PACKAGE_NAME));
      console.log(`  Config:     ${referenced ? 'Referenced in opencode.json' : 'Not yet added to opencode.json'}`);
    } catch {
      console.log(`  Config:     opencode.json found but could not parse`);
    }
  } else {
    console.log(`  Config:     No opencode.json found (run 'swe-pro-agents setup')`);
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
  console.log(`    setup     Show the opencode.json config snippet`);
  console.log(`    status    Show installation status`);
  console.log(`    teams     List available team configurations`);
  console.log(`    version   Show package version`);
  console.log(`    help      Show this help\n`);
}

const cmd = process.argv[2] || 'help';

switch (cmd) {
  case 'setup':
    cmdSetup();
    break;
  case 'status':
    cmdStatus();
    break;
  case 'teams':
    cmdTeams();
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
