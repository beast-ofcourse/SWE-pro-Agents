#!/usr/bin/env node

/**
 * CLI for managing SWE Pro Agents installation.
 *
 * Usage:
 *   swe-pro-agents setup    — Show the opencode.json config snippet
 *   swe-pro-agents status   — Show installation status
 *   swe-pro-agents version  — Show version
 *   swe-pro-agents help     — Show this help
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PACKAGE_NAME = 'swe-pro-agents';
const AGENTS_DIR = path.join(__dirname, '..', 'agents');
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

  console.log(`\n  SWE Pro Agents — Status`);
  console.log(`  ${'─'.repeat(40)}`);
  console.log(`  Version:    ${pkg.version}`);
  console.log(`  Package:    ${agentCount} agent profiles`);
  console.log(`  Installed:  ${installedCount > 0 ? `${installedCount} agents at ${TARGET_DIR}` : 'Not installed'}`);

  if (installedCount > 0 && installedCount !== agentCount) {
    console.log(`  Warning: installed count (${installedCount}) doesn't match package (${agentCount}). Run 'npm update -g swe-pro-agents'.`);
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
