'use strict';

/**
 * build-plugin.js — codegen for plugins/swe-pro-agents.js.
 *
 * The plugin is a GENERATED file: hand-authored template (file header comment,
 * requires, /goal command, hooks, server bootstrap, export block) plus marker
 * regions whose bodies come from single-source scripts/ modules:
 *
 *   // <swe-pro-generated src="scripts/loop-gate.js">
 *   ...body copied from scripts/loop-gate.js...
 *   // </swe-pro-generated>
 *
 * Why codegen: OpenCode loads plugins from ~/.config/opencode/plugins/ where a
 * plugin file can only require sibling files, never ../scripts. The logic is
 * therefore inlined into the plugin, but scripts/ stays the single authored
 * copy — the builder copies it in. Never hand-edit a region body; edit the
 * scripts/ source and regenerate.
 *
 * Body transform (source -> region): drop the shebang line, 'use strict'
 * directives (the plugin template is already strict), builtin require() lines
 * (the template already requires the same node built-ins; redeclaring consts
 * would throw), and `module.exports =` assignment lines (inlined assignments
 * would clobber the plugin's own export block at the bottom). A single-line
 * scripts-relative require('./<name>') (no `..`, no subdirs) is REPLACED with
 * a `// (see scripts/<name>.js region — provides <names>)` comment naming the
 * identifiers bound on that line; the target must exist under scripts/ and the
 * plugin must carry a generated region for that exact src (an inlined
 * reference with no region would be a runtime ReferenceError). Transitive
 * sibling requires resolve recursively with a visited set (cycles fail
 * loudly). Any other non-builtin require still fails loudly. Sources must keep
 * requires single-line and `module.exports =` on one line; anything left over
 * mentioning require()/module.exports fails loudly instead of leaking.
 * Leading/trailing blank padding is trimmed; every other byte is preserved.
 *
 * Reconcile decisions (scripts/ is source of truth afterward):
 * - scripts/loop-gate.js — no behavioral delta found (verified by normalized
 *   diff ignoring comments/blanks/identifiers). Adopted the plugin's
 *   collision-avoiding identifiers (gateStateFile/gateReadState/
 *   ledgerResumable/resetGate) as canonical so codegen is byte-identical;
 *   public export KEYS unchanged (scripts/ledger.js uses _shouldResume,
 *   test/loop-gate.test.js uses the public names).
 * - scripts/pack-config.js — no behavioral delta on the read path (the plugin
 *   subset equals loadConfig behaviorally); neither copy had a fix the other
 *   lacked, so nothing was ported. scripts/ is the superset (CLI write path:
 *   defaultConfig/configPath/writeConfig, consumed by bin/ and
 *   test/pack-config.test.js), so the generated region carries those helpers
 *   as pure additions after the plugin-identical read path; they are inert in
 *   the plugin. Single-line module.exports kept (strip convention).
 * - scripts/background-worktree.js — NEW, faithful extraction of the plugin's
 *   worktree-manager section (~line 150ff). Logic untouched; requires plus a
 *   single-line module.exports added so tests can require it directly.
  * - scripts/background-delegate.js — NEW, faithful extraction of the plugin's
  *   delegation-engine section (~line 201ff), ending before the "Adapter
  *   helpers" glue (notifyParent stays hand-authored template: it only adapts
  *   the engine to the plugin client). Logic untouched; requires plus a
  *   single-line module.exports added so tests can require it directly.
  * - scripts/background-dashboard.js — NEW, operator glance views for T-032
  *   (renderTree/toJson, consumed by the hand-authored bg_dashboard tool and
  *   the bg_status json:true branch). Same requires/strip conventions.
 *
 * CLI: node scripts/build-plugin.js [--check] [pluginPath]
 *   default rewrites plugins/swe-pro-agents.js in place (atomic .tmp+rename);
 *   --check exits 0 when regeneration is byte-identical, 1 with a per-region
 *   diff summary otherwise. Only node built-ins.
 */

const fs = require('fs');
const path = require('path');
const { builtinModules } = require('module');

const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_PLUGIN_REL = path.join('plugins', 'swe-pro-agents.js');

const OPEN_PATTERN = /^\s*\/\/\s*<swe-pro-generated\s+src="([^"]+)"\s*>\s*$/;
const CLOSE_PATTERN = /^\s*\/\/\s*<\/swe-pro-generated>\s*$/;
const REQUIRE_LINE = /^\s*(?:(?:const|let|var)\s+[^=;]+=\s*)?require\s*\(.*\)\s*;\s*$/;
const EXPORT_LINE = /^\s*module\.exports\s*=/;
const USE_STRICT_LINE = /^\s*'use strict';\s*$/;
const SHEBANG_LINE = /^#!/;
const REQUIRE_TARGET = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/;
const LEFTOVER_EXPORT = /module\.exports/;
const LEFTOVER_REQUIRE = /\brequire\s*\(/;

const BUILTIN_NAMES = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

const USAGE = 'Usage: node scripts/build-plugin.js [--check] [pluginPath]\n'
  + '  Rewrites the plugin in place (atomic write). --check verifies freshness.';

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const parsed = { check: false, help: false, pluginPath: null };
  for (const token of argv) {
    if (token === '--check') parsed.check = true;
    else if (token === '--help' || token === '-h') parsed.help = true;
    else if (token.startsWith('-')) fail(`unknown flag ${token} (${USAGE})`);
    else if (parsed.pluginPath) fail(`unexpected argument ${token} (${USAGE})`);
    else parsed.pluginPath = token;
  }
  return parsed;
}

function detectEol(text, label) {
  const crlfCount = (text.match(/\r\n/g) || []).length;
  const loneLfCount = (text.replace(/\r\n/g, '').match(/\n/g) || []).length;
  if (crlfCount > 0 && loneLfCount > 0) fail(`${label} mixes CRLF and LF endings; normalize first`);
  return crlfCount > 0 ? '\r\n' : '\n';
}

function resolveSource(src, pluginPath) {
  if (!src.startsWith('scripts/') || src.includes('..')) {
    fail(`invalid region src ${JSON.stringify(src)} in ${pluginPath}: must be a scripts/ path without ".."`);
  }
  const absolute = path.resolve(REPO_ROOT, src);
  if (absolute !== REPO_ROOT && !absolute.startsWith(REPO_ROOT + path.sep)) fail(`region src escapes repo: ${src}`);
  if (!fs.existsSync(absolute)) fail(`region src does not exist: ${src}`);
  return absolute;
}

function siblingTargetSrc(rawTarget, sourceAbs) {
  if (!rawTarget.startsWith('./')) {
    if (rawTarget.startsWith('.') || rawTarget.startsWith('/')) {
      fail(`source ${sourceAbs} requires ${JSON.stringify(rawTarget)}: no non-sibling paths may inline into the plugin (only './<name>' with no ".." and no subdirs)`);
    }
    fail(`source ${sourceAbs} requires ${JSON.stringify(rawTarget)}: only node built-ins may inline into the plugin`);
  }
  const rest = rawTarget.slice(2);
  if (!rest || rest.startsWith('.') || rest.includes('/') || rest.includes('\\') || rest.includes('..')) {
    fail(`source ${sourceAbs} requires ${JSON.stringify(rawTarget)}: sibling requires must be a plain './<name>' (no "..", no subdirs)`);
  }
  return `scripts/${rest.endsWith('.js') ? rest : `${rest}.js`}`;
}

function parseRequireNames(line, sourceAbs) {
  const declared = line.match(/^\s*(?:const|let|var)\s+(.+?)\s*=\s*require\s*\(/);
  if (!declared) {
    fail(`source ${sourceAbs} has a side-effect sibling require ${JSON.stringify(line.trim())}: bind its exports to identifiers (a bare require() cannot inline into the plugin)`);
  }
  const lhs = declared[1].trim();
  if (lhs.startsWith('{')) {
    if (!lhs.endsWith('}')) fail(`source ${sourceAbs} has an unparseable require binding ${JSON.stringify(line.trim())}: keep the destructure on one line`);
    const inside = lhs.slice(1, -1).trim();
    if (!inside) fail(`source ${sourceAbs} has an empty require destructure ${JSON.stringify(line.trim())}`);
    const names = [];
    for (const part of inside.split(',')) {
      const item = part.trim();
      const aliased = item.match(/^([A-Za-z_$][\w$]*)\s*:\s*([A-Za-z_$][\w$]*)$/);
      if (aliased) {
        names.push(aliased[2]);
        continue;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(item)) {
        names.push(item);
        continue;
      }
      fail(`source ${sourceAbs} has an unparseable require binding ${JSON.stringify(line.trim())}: use plain identifiers or "original: local" aliases`);
    }
    return names.join(', ');
  }
  if (/^[A-Za-z_$][\w$]*$/.test(lhs)) return lhs;
  fail(`source ${sourceAbs} has an unparseable require binding ${JSON.stringify(line.trim())}: bind to an identifier or a plain destructure`);
}

function checkSiblingLine(line, sourceAbs, regionSrcs, stack) {
  const target = line.match(REQUIRE_TARGET);
  const raw = target ? target[1] : '';
  if (!raw) fail(`source ${sourceAbs} has a dynamic require() ${JSON.stringify(line.trim())} (keep requires single-line with a string literal)`);
  if (!raw.startsWith('.') && !raw.startsWith('/') && BUILTIN_NAMES.has(raw.replace(/^node:/, ''))) return null;
  const src = siblingTargetSrc(raw, sourceAbs);
  const absolute = path.resolve(REPO_ROOT, src);
  if (absolute !== REPO_ROOT && !absolute.startsWith(REPO_ROOT + path.sep)) fail(`region src escapes repo: ${src}`);
  if (!fs.existsSync(absolute)) fail(`source ${sourceAbs} requires ${JSON.stringify(raw)}: target file does not exist (${src})`);
  if (!regionSrcs.has(src)) {
    fail(`source ${sourceAbs} requires ${JSON.stringify(raw)} but the plugin has no generated region for ${src} (the inlined reference would be a runtime ReferenceError)`);
  }
  if (stack.includes(src)) fail(`cyclic sibling require detected: ${stack.join(' -> ')} -> ${src}`);
  const names = parseRequireNames(line, sourceAbs);
  assertSiblingClosure(absolute, regionSrcs, stack.concat([src]));
  return { src, names };
}

function assertSiblingClosure(fileAbs, regionSrcs, stack) {
  let text;
  try {
    text = fs.readFileSync(fileAbs, 'utf8');
  } catch (err) {
    fail(`cannot read source ${fileAbs}: ${err.message}`);
  }
  for (const line of text.split(/\r?\n/)) {
    if (!REQUIRE_LINE.test(line)) continue;
    checkSiblingLine(line, fileAbs, regionSrcs, stack);
  }
}

function loadSourceBody(sourceAbs, pluginEol, regionSrcs, stack) {
  let text;
  try {
    text = fs.readFileSync(sourceAbs, 'utf8');
  } catch (err) {
    fail(`cannot read source ${sourceAbs}: ${err.message}`);
  }
  if (text.includes('\uFEFF')) fail(`source ${sourceAbs} contains a BOM; save as plain UTF-8`);
  const sourceEol = detectEol(text, `source ${sourceAbs}`);
  const kept = [];
  for (const line of text.split(sourceEol)) {
    if (SHEBANG_LINE.test(line)) continue; // valid only at byte 0 of a file
    if (USE_STRICT_LINE.test(line)) continue; // the plugin template is already strict
    if (REQUIRE_LINE.test(line)) {
      const sibling = checkSiblingLine(line, sourceAbs, regionSrcs, stack);
      if (!sibling) continue; // the template already requires the same built-ins
      // In-plugin the names resolve from the sibling region (same module
      // scope, hoisted); in scripts/ they resolve via the normal require.
      const indent = (line.match(/^\s*/) || [''])[0];
      kept.push(`${indent}// (see ${sibling.src} region — provides ${sibling.names})`);
      continue;
    }
    if (EXPORT_LINE.test(line)) continue; // the plugin owns the export block
    kept.push(line);
  }
  while (kept.length > 0 && kept[0].trim() === '') kept.shift();
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  if (kept.length === 0) fail(`source ${sourceAbs} produced an empty region body`);
  const body = kept.join(pluginEol);
  if (LEFTOVER_EXPORT.test(body)) fail(`source ${sourceAbs} still mentions module.exports (keep the export assignment on one line)`);
  if (LEFTOVER_REQUIRE.test(body)) fail(`source ${sourceAbs} still calls require() (keep requires single-line)`);
  return kept;
}

function findRegions(pluginLines, pluginPath) {
  const regions = [];
  let open = null;
  pluginLines.forEach((line, index) => {
    const opened = line.match(OPEN_PATTERN);
    if (opened) {
      if (open) fail(`nested generated region at ${pluginPath}:${index + 1} (unclosed src="${open.src}")`);
      open = { src: opened[1], openLine: index };
      return;
    }
    if (CLOSE_PATTERN.test(line)) {
      if (!open) fail(`closing marker without opener at ${pluginPath}:${index + 1}`);
      regions.push({ src: open.src, openLine: open.openLine, closeLine: index });
      open = null;
    }
  });
  if (open) fail(`unclosed generated region src="${open.src}" (opened at ${pluginPath}:${open.openLine + 1})`);
  if (regions.length === 0) fail(`no generated regions in ${pluginPath}`);
  return regions;
}

function regenerate(pluginText, pluginPath) {
  const pluginEol = detectEol(pluginText, `plugin ${pluginPath}`);
  const pluginLines = pluginText.split(pluginEol);
  const regions = findRegions(pluginLines, pluginPath);
  const regionSrcs = new Set(regions.map((region) => region.src));
  const updated = pluginLines.slice();
  const report = [];
  for (let i = regions.length - 1; i >= 0; i -= 1) {
    const region = regions[i];
    const sourceAbs = resolveSource(region.src, pluginPath);
    const fresh = loadSourceBody(sourceAbs, pluginEol, regionSrcs, [region.src]);
    const current = pluginLines.slice(region.openLine + 1, region.closeLine);
    let firstDiff = -1;
    const width = Math.max(current.length, fresh.length);
    for (let k = 0; k < width; k += 1) {
      if (current[k] !== fresh[k]) {
        firstDiff = k;
        break;
      }
    }
    if (firstDiff === -1) {
      report.push({ src: region.src, changed: false });
    } else {
      updated.splice(region.openLine + 1, region.closeLine - region.openLine - 1, ...fresh);
      report.push({
        src: region.src,
        changed: true,
        oldLines: current.length,
        newLines: fresh.length,
        firstPluginLine: region.openLine + 2 + firstDiff,
      });
    }
  }
  report.reverse();
  return { text: updated.join(pluginEol), report };
}

function writeAtomic(targetPath, text) {
  const tmp = `${targetPath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    fs.renameSync(tmp, targetPath);
  } catch (err) {
    let cleanupNote = '';
    try {
      fs.unlinkSync(tmp);
    } catch (cleanupErr) {
      cleanupNote = ` (stale tmp ${tmp}: ${cleanupErr.message})`;
    }
    fail(`cannot write ${targetPath}: ${err.message}${cleanupNote}`);
  }
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  const pluginPath = args.pluginPath ? path.resolve(args.pluginPath) : path.join(REPO_ROOT, DEFAULT_PLUGIN_REL);
  let pluginText;
  try {
    pluginText = fs.readFileSync(pluginPath, 'utf8');
  } catch (err) {
    fail(`cannot read plugin ${pluginPath}: ${err.message}`);
  }
  const { text: next, report } = regenerate(pluginText, pluginPath);
  const changed = report.filter((entry) => entry.changed);
  if (args.check) {
    if (changed.length === 0) {
      console.log(`${pluginPath} is fresh (${report.length} regions verified)`);
      return 0;
    }
    console.error(`stale generated code in ${pluginPath}:`);
    for (const entry of changed) {
      console.error(`  src="${entry.src}": ${entry.oldLines} -> ${entry.newLines} lines (first difference at line ${entry.firstPluginLine})`);
    }
    console.error('run `node scripts/build-plugin.js` to regenerate');
    return 1;
  }
  if (changed.length === 0) {
    console.log(`${pluginPath} is fresh (no changes)`);
    return 0;
  }
  writeAtomic(pluginPath, next);
  console.log(`regenerated ${pluginPath} (${changed.length} region(s) updated)`);
  return 0;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (err) {
  console.error(`build-plugin: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
}
