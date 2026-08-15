#!/usr/bin/env node

/**
 * Installer lifecycle smoke tests for scripts/install.js and scripts/uninstall.js.
 *
 * Everything runs against a throwaway HOME/USERPROFILE directory, so the real
 * ~/.config/opencode is never touched. Covers:
 *   1. fresh install   — agents + skills + plugins land in the right places, manifest written
 *   2. idempotent reinstall
 *   3. update          — stale agents/skills/plugins recorded in an old manifest get pruned
 *   4. no manifest     — installer never guesses ownership, unknown files survive
 *   5. uninstall       — removes only pack-owned files; user skills survive
 *   6. uninstall w/o manifest — agents dir removed, user skills untouched
 *   7. plugins         — fresh install copies both plugin files + records names;
 *                        update prunes stale swe-pro-agents-* files; non-prefixed
 *                        files in the plugin dir are never touched; uninstall
 *                        removes the pack's prefixed plugins and leaves user
 *                        plugins alone (and the whole dir untouched without a
 *                        manifest)
 *
 * Zero dependencies: node:assert + node:child_process + node:fs.
 * Run with: node test/installer.test.js
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const NODE = process.execPath;
const INSTALL = path.join(REPO, 'scripts', 'install.js');
const UNINSTALL = path.join(REPO, 'scripts', 'uninstall.js');

const PACKAGE_NAME = 'swe-pro-agents';

const AGENT_FILES = fs
  .readdirSync(path.join(REPO, 'agents'))
  .filter((f) => f.endsWith('.md'))
  .sort();

const SKILL_NAMES = fs
  .readdirSync(path.join(REPO, 'skills'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && fs.existsSync(path.join(REPO, 'skills', e.name, 'SKILL.md')))
  .map((e) => e.name)
  .sort();

// Plugin basenames the pack installs into the global plugin dir (see
// scripts/install.js listPackPlugins — the only plugin is
// plugins/continuation.js; scripts/loop-logic.js is a library consumed by the
// CLI, never installed as a plugin).
const PLUGIN_NAMES = ['swe-pro-agents-continuation.js'];

const agentsDir = (home) => path.join(home, '.config', 'opencode', 'agents', PACKAGE_NAME);
const skillsDir = (home) => path.join(home, '.config', 'opencode', 'skills');
const pluginsDir = (home) => path.join(home, '.config', 'opencode', 'plugins');
const packConfigDir = (home) => path.join(home, '.config', 'swe-pro-agents');
const manifestPath = (home) => path.join(packConfigDir(home), 'manifest.json');
const packAgentsMd = (home) => path.join(packConfigDir(home), 'AGENTS.md');

/** Temp HOME directories created during this run, removed at process exit. */
const tempHomes = [];

/** Create a throwaway HOME directory, tracked so it is cleaned up at exit. */
function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'swe-pro-agents-test-'));
  tempHomes.push(home);
  return home;
}

// Sync-only in the handler, so it also runs when tests fail (process.exit(1)).
process.on('exit', () => {
  for (const home of tempHomes) {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

/** Run one of the lifecycle scripts with HOME/USERPROFILE redirected to `home`. */
function run(script, home) {
  const res = spawnSync(NODE, [script], {
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOMEDRIVE: path.parse(home).root,
      HOMEPATH: home.replace(path.parse(home).root, ''),
    },
    encoding: 'utf8',
  });
  assert.strictEqual(
    res.status,
    0,
    `${path.basename(script)} exited ${res.status}:\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`
  );
  return res.stdout;
}

/** Read the manifest written by install.js into the temp HOME. */
function readManifest(home) {
  const raw = fs.readFileSync(manifestPath(home), 'utf-8');
  return JSON.parse(raw);
}

/** Sorted top-level names of dir (empty array if dir does not exist). */
function listDirFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort();
}

/** Recursive relative paths of every file under dir (sorted). */
function listTreeFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  (function walk(current, rel) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(current, entry.name), childRel);
      else out.push(childRel);
    }
  })(dir, '');
  return out.sort();
}

let passed = 0;
let failed = 0;

/** Run one test; prints the outcome and records pass/fail totals. */
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL - ${name}\n  ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Fresh install
// ---------------------------------------------------------------------------
test('fresh install copies agents, skills, AGENTS.md and writes the manifest', () => {
  const home = tempHome();
  run(INSTALL, home);

  // The agents dir must contain ONLY agent profiles — AGENTS.md is shared
  // foundation, and OpenCode would load it as a phantom agent if it lived here.
  const agents = listDirFiles(agentsDir(home));
  assert.deepStrictEqual(agents, AGENT_FILES, 'agents dir content (no AGENTS.md)');
  assert.ok(fs.existsSync(packAgentsMd(home)), 'AGENTS.md copy installed to pack config dir');

  for (const name of SKILL_NAMES) {
    assert.ok(fs.existsSync(path.join(skillsDir(home), name, 'SKILL.md')), `skill ${name} installed`);
  }

  const manifest = readManifest(home);
  assert.deepStrictEqual(manifest.agents, AGENT_FILES, 'manifest.agents');
  assert.deepStrictEqual(manifest.skills, SKILL_NAMES, 'manifest.skills');
  assert.strictEqual(manifest.packageVersion, require(path.join(REPO, 'package.json')).version);
});

// ---------------------------------------------------------------------------
// 1b. Legacy AGENTS.md inside the agents dir is cleaned up (phantom agent fix)
// ---------------------------------------------------------------------------
test('install removes a legacy AGENTS.md from the agents dir (phantom agent fix)', () => {
  const home = tempHome();
  fs.mkdirSync(agentsDir(home), { recursive: true });
  fs.writeFileSync(path.join(agentsDir(home), 'AGENTS.md'), '# legacy\n');

  run(INSTALL, home);

  assert.ok(!fs.existsSync(path.join(agentsDir(home), 'AGENTS.md')), 'legacy AGENTS.md removed from agents dir');
  assert.ok(fs.existsSync(packAgentsMd(home)), 'AGENTS.md copy present in pack config dir');
});

// ---------------------------------------------------------------------------
// 2. Idempotent reinstall
// ---------------------------------------------------------------------------
test('reinstall is idempotent — no duplicates, same layout', () => {
  const home = tempHome();
  run(INSTALL, home);
  run(INSTALL, home);

  assert.strictEqual(listDirFiles(agentsDir(home)).length, AGENT_FILES.length);
  for (const name of SKILL_NAMES) {
    const installed = listTreeFiles(path.join(skillsDir(home), name));
    const expected = listTreeFiles(path.join(REPO, 'skills', name));
    assert.deepStrictEqual(installed, expected, `${name} tree matches the pack`);
  }
});

// ---------------------------------------------------------------------------
// 3. Update prunes stale files recorded in an old manifest
// ---------------------------------------------------------------------------
test('update prunes stale agents and skills recorded in a previous manifest', () => {
  const home = tempHome();
  fs.mkdirSync(agentsDir(home), { recursive: true });
  fs.mkdirSync(path.join(skillsDir(home), 'stale-skill'), { recursive: true });
  fs.writeFileSync(path.join(agentsDir(home), 'stale-agent.md'), '# stale\n');
  fs.writeFileSync(path.join(skillsDir(home), 'stale-skill', 'SKILL.md'), '# stale\n');
  const manifestDir = path.join(home, '.config', 'swe-pro-agents');
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    manifestPath(home),
    JSON.stringify({ packageVersion: '0.0.1', agents: [...AGENT_FILES, 'stale-agent.md'], skills: [...SKILL_NAMES, 'stale-skill'] })
  );

  run(INSTALL, home);

  assert.ok(!fs.existsSync(path.join(agentsDir(home), 'stale-agent.md')), 'stale agent pruned');
  assert.ok(!fs.existsSync(path.join(skillsDir(home), 'stale-skill')), 'stale skill pruned');
  assert.ok(fs.existsSync(path.join(agentsDir(home), AGENT_FILES[0])), 'current agents intact');
  const manifest = readManifest(home);
  assert.deepStrictEqual(manifest.agents, AGENT_FILES, 'manifest no longer lists stale agent');
});

// ---------------------------------------------------------------------------
// 4. No manifest — installer never guesses ownership
// ---------------------------------------------------------------------------
test('without a manifest the installer prunes nothing it did not track', () => {
  const home = tempHome();
  fs.mkdirSync(agentsDir(home), { recursive: true });
  fs.writeFileSync(path.join(agentsDir(home), 'unrelated-agent.md'), '# not ours\n');

  run(INSTALL, home);

  assert.ok(fs.existsSync(path.join(agentsDir(home), 'unrelated-agent.md')), 'untracked file survives');
  assert.ok(fs.existsSync(path.join(agentsDir(home), AGENT_FILES[0])), 'pack agents installed');
});

// ---------------------------------------------------------------------------
// 5. Uninstall with manifest — user skills survive
// ---------------------------------------------------------------------------
test('uninstall removes pack files only; user skills survive', () => {
  const home = tempHome();
  fs.mkdirSync(path.join(skillsDir(home), 'my-own-skill'), { recursive: true });
  fs.writeFileSync(path.join(skillsDir(home), 'my-own-skill', 'SKILL.md'), '# mine\n');

  run(INSTALL, home);
  run(UNINSTALL, home);

  assert.ok(!fs.existsSync(agentsDir(home)), 'agents dir removed');
  assert.ok(!fs.existsSync(path.join(skillsDir(home), SKILL_NAMES[0])), 'pack skill removed');
  assert.ok(fs.existsSync(path.join(skillsDir(home), 'my-own-skill', 'SKILL.md')), 'user skill survives');
  assert.ok(!fs.existsSync(path.join(home, '.config', 'swe-pro-agents')), 'manifest dir removed');
});

// ---------------------------------------------------------------------------
// 6. Uninstall without manifest
// ---------------------------------------------------------------------------
test('uninstall without manifest still removes the package-scoped agents dir, leaves skills', () => {
  const home = tempHome();
  fs.mkdirSync(agentsDir(home), { recursive: true });
  fs.writeFileSync(path.join(agentsDir(home), 'agent.md'), '# x\n');
  fs.mkdirSync(path.join(skillsDir(home), 'orphan-skill'), { recursive: true });

  const out = run(UNINSTALL, home);

  assert.ok(!fs.existsSync(agentsDir(home)), 'agents dir removed');
  assert.ok(fs.existsSync(path.join(skillsDir(home), 'orphan-skill')), 'skills untouched without manifest');
  assert.ok(/could not determine/.test(out), 'output warns about undeterminable skills');
});

// ---------------------------------------------------------------------------
// 7. Plugins
// ---------------------------------------------------------------------------
test('fresh install copies the plugin file and records its name in the manifest', () => {
  const home = tempHome();
  run(INSTALL, home);

  for (const name of PLUGIN_NAMES) {
    assert.ok(fs.existsSync(path.join(pluginsDir(home), name)), `plugin ${name} installed`);
  }
  // Content matches the pack source (plugins/continuation.js).
  assert.deepStrictEqual(
    fs.readFileSync(path.join(pluginsDir(home), 'swe-pro-agents-continuation.js'), 'utf-8'),
    fs.readFileSync(path.join(REPO, 'plugins', 'continuation.js'), 'utf-8'),
    'continuation plugin content matches the pack'
  );

  const manifest = readManifest(home);
  assert.deepStrictEqual(manifest.plugins, PLUGIN_NAMES, 'manifest.plugins');
});

test('update prunes a stale swe-pro-agents-* plugin recorded in a previous manifest', () => {
  const home = tempHome();
  fs.mkdirSync(pluginsDir(home), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir(home), 'swe-pro-agents-old-plugin.js'), '# stale\n');
  const manifestDir = path.join(home, '.config', 'swe-pro-agents');
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    manifestPath(home),
    JSON.stringify({
      packageVersion: '0.0.1',
      agents: AGENT_FILES,
      skills: SKILL_NAMES,
      plugins: [...PLUGIN_NAMES, 'swe-pro-agents-old-plugin.js'],
    })
  );

  run(INSTALL, home);

  assert.ok(!fs.existsSync(path.join(pluginsDir(home), 'swe-pro-agents-old-plugin.js')), 'stale plugin pruned');
  for (const name of PLUGIN_NAMES) {
    assert.ok(fs.existsSync(path.join(pluginsDir(home), name)), `current plugin ${name} intact`);
  }
  const manifest = readManifest(home);
  assert.deepStrictEqual(manifest.plugins, PLUGIN_NAMES, 'manifest no longer lists stale plugin');
});

test('a non-prefixed plugin file in the plugin dir survives install and update', () => {
  const home = tempHome();
  fs.mkdirSync(pluginsDir(home), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir(home), 'my-own-plugin.js'), '# mine\n');

  run(INSTALL, home);
  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'my-own-plugin.js')), 'user plugin survives install');

  // Update: the manifest now exists, so pruning runs — but the user's
  // non-prefixed file is never in the manifest and never matches the
  // swe-pro-agents-* prefix, so it must survive.
  run(INSTALL, home);
  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'my-own-plugin.js')), 'user plugin survives update');
});

test('uninstall removes the pack plugin files and leaves non-prefixed user plugins', () => {
  const home = tempHome();
  fs.mkdirSync(pluginsDir(home), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir(home), 'my-own-plugin.js'), '# mine\n');

  run(INSTALL, home);
  run(UNINSTALL, home);

  for (const name of PLUGIN_NAMES) {
    assert.ok(!fs.existsSync(path.join(pluginsDir(home), name)), `pack plugin ${name} removed`);
  }
  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'my-own-plugin.js')), 'user plugin survives uninstall');
});

test('uninstall without a manifest leaves the plugin dir untouched', () => {
  const home = tempHome();
  fs.mkdirSync(pluginsDir(home), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir(home), 'swe-pro-agents-continuation.js'), '# x\n');
  fs.writeFileSync(path.join(pluginsDir(home), 'my-own-plugin.js'), '# mine\n');

  run(UNINSTALL, home);

  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'swe-pro-agents-continuation.js')), 'prefixed plugin untouched without manifest');
  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'my-own-plugin.js')), 'user plugin untouched without manifest');
});

test('uninstall with a legacy manifest (no plugins array) leaves prefixed plugins', () => {
  const home = tempHome();
  fs.mkdirSync(pluginsDir(home), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir(home), 'swe-pro-agents-continuation.js'), '# x\n');
  fs.writeFileSync(path.join(pluginsDir(home), 'my-own-plugin.js'), '# mine\n');
  const manifestDir = path.join(home, '.config', 'swe-pro-agents');
  fs.mkdirSync(manifestDir, { recursive: true });
  // Pre-2.6.x manifests recorded agents and skills but no plugins array —
  // they prove nothing about plugin ownership, so nothing may be removed.
  fs.writeFileSync(
    manifestPath(home),
    JSON.stringify({ packageVersion: '2.5.0', agents: AGENT_FILES, skills: SKILL_NAMES })
  );

  run(UNINSTALL, home);

  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'swe-pro-agents-continuation.js')), 'prefixed plugin untouched by a legacy manifest');
  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'my-own-plugin.js')), 'user plugin untouched');
});

test('uninstall skips non-string manifest.plugins entries without throwing', () => {
  const home = tempHome();
  fs.mkdirSync(pluginsDir(home), { recursive: true });
  fs.writeFileSync(path.join(pluginsDir(home), 'swe-pro-agents-continuation.js'), '# x\n');
  fs.writeFileSync(path.join(pluginsDir(home), 'my-own-plugin.js'), '# mine\n');
  const manifestDir = path.join(home, '.config', 'swe-pro-agents');
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    manifestPath(home),
    JSON.stringify({
      packageVersion: '2.7.0',
      agents: AGENT_FILES,
      skills: SKILL_NAMES,
      plugins: ['swe-pro-agents-continuation.js', 42, { name: 'evil' }],
    })
  );

  run(UNINSTALL, home);

  assert.ok(!fs.existsSync(path.join(pluginsDir(home), 'swe-pro-agents-continuation.js')), 'valid recorded plugin removed');
  assert.ok(fs.existsSync(path.join(pluginsDir(home), 'my-own-plugin.js')), 'user plugin untouched');
});

// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
