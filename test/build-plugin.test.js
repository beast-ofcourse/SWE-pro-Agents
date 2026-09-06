'use strict';

/**
 * build-plugin.test.js — plain-node tests for scripts/build-plugin.js codegen.
 * (1) regenerating into a temp copy of the plugin is byte-identical to the
 * committed plugin; (2) --check exits 0 on the clean tree; (3) tampering a
 * temp copy makes --check fail.
 */

const assert = require('assert');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BUILDER = path.join(REPO_ROOT, 'scripts', 'build-plugin.js');
const PLUGIN = path.join(REPO_ROOT, 'plugins', 'swe-pro-agents.js');

function tempCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-'));
  const copy = path.join(dir, 'swe-pro-agents.js');
  fs.copyFileSync(PLUGIN, copy);
  return copy;
}

function removeTempCopy(copy) {
  fs.rmSync(path.dirname(copy), { recursive: true, force: true });
}

function runBuilder(args) {
  try {
    const stdout = execFileSync(process.execPath, [BUILDER, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output: stdout };
  } catch (err) {
    const out = String((err.stdout || '') + (err.stderr || ''));
    return { status: typeof err.status === 'number' ? err.status : 1, output: out };
  }
}

async function run() {
  let passed = 0;
  let failed = 0;
  function check(name, fn) {
    return Promise.resolve()
      .then(() => fn())
      .then(() => {
        console.log('PASS  ' + name);
        passed += 1;
      })
      .catch((err) => {
        console.log('FAIL  ' + name + ': ' + err.message);
        failed += 1;
      });
  }

  await check('regenerating into a temp copy is byte-identical to the committed plugin', async () => {
    const copy = tempCopy();
    try {
      const committed = fs.readFileSync(PLUGIN, 'utf8');
      const markers = committed.match(/<swe-pro-generated/g) || [];
      assert.strictEqual(markers.length, 9, `committed plugin must carry 9 generated regions, found ${markers.length}`);
      const res = runBuilder([copy]);
      assert.strictEqual(res.status, 0, `builder exits 0, got ${res.status}: ${res.output}`);
      assert.strictEqual(fs.readFileSync(copy, 'utf8'), committed, 'regenerated temp copy matches committed plugin byte-for-byte');
    } finally {
      removeTempCopy(copy);
    }
  });

  await check('--check exits 0 on the clean tree', async () => {
    const res = runBuilder(['--check']);
    assert.strictEqual(res.status, 0, `--check exits 0, got ${res.status}: ${res.output}`);
  });

  await check('tampering a temp copy makes --check fail', async () => {
    const copy = tempCopy();
    try {
      const original = fs.readFileSync(copy, 'utf8');
      const tampered = original.replace("const LOOP_AGENT = 'swe-pro';", "const LOOP_AGENT = 'tampered';");
      assert.notStrictEqual(tampered, original, 'tamper target must exist in the plugin copy');
      fs.writeFileSync(copy, tampered, 'utf8');
      const res = runBuilder(['--check', copy]);
      assert.notStrictEqual(res.status, 0, '--check must fail on a tampered copy, got status 0');
      assert.ok(res.output.includes('background-delegate.js') || res.output.includes('loop-gate.js'), `--check names the stale region: ${res.output}`);
    } finally {
      removeTempCopy(copy);
    }
  });

  await check('sibling require inlines as a region comment (no require() remains)', async () => {
    const tag = `bpsib${process.pid}`;
    const otherSrc = `scripts/__${tag}_other.js`;
    const mainSrc = `scripts/__${tag}_main.js`;
    const otherAbs = path.join(REPO_ROOT, otherSrc);
    const mainAbs = path.join(REPO_ROOT, mainSrc);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-sib-'));
    const skeleton = path.join(dir, 'swe-pro-agents.js');
    try {
      fs.writeFileSync(otherAbs, "'use strict';\n\nfunction foo() { return 1; }\n\nmodule.exports = { foo };\n", 'utf8');
      fs.writeFileSync(mainAbs, `'use strict';\n\nconst { foo } = require('./__${tag}_other');\n\nfunction useFoo() { return foo(); }\n\nmodule.exports = { useFoo };\n`, 'utf8');
      fs.writeFileSync(skeleton, `'use strict';\n\n// <swe-pro-generated src="${otherSrc}">\n// stale\n// </swe-pro-generated>\n\n// <swe-pro-generated src="${mainSrc}">\n// stale\n// </swe-pro-generated>\n`, 'utf8');
      const res = runBuilder([skeleton]);
      assert.strictEqual(res.status, 0, `builder exits 0, got ${res.status}: ${res.output}`);
      const out = fs.readFileSync(skeleton, 'utf8');
      assert.ok(!out.includes('require('), 'regenerated skeleton must not call require(): ' + out);
      assert.ok(out.includes(`// (see ${otherSrc} region — provides foo)`), 'sibling require becomes a region comment: ' + out);
      assert.ok(out.includes('function foo() { return 1; }'), 'other region body intact: ' + out);
      assert.ok(out.includes('function useFoo() { return foo(); }'), 'main region body intact: ' + out);
    } finally {
      try { fs.unlinkSync(otherAbs); } catch {}
      try { fs.unlinkSync(mainAbs); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await check('sibling require with no region fails loudly', async () => {
    const tag = `bpnoreg${process.pid}`;
    const missingSrc = `scripts/__${tag}_missing.js`;
    const mainSrc = `scripts/__${tag}_main.js`;
    const missingAbs = path.join(REPO_ROOT, missingSrc);
    const mainAbs = path.join(REPO_ROOT, mainSrc);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-plugin-noreg-'));
    const skeleton = path.join(dir, 'swe-pro-agents.js');
    try {
      fs.writeFileSync(missingAbs, "'use strict';\n\nfunction missing() { return 1; }\n\nmodule.exports = { missing };\n", 'utf8');
      fs.writeFileSync(mainAbs, `'use strict';\n\nconst { missing } = require('./__${tag}_missing');\n\nfunction useMissing() { return missing(); }\n\nmodule.exports = { useMissing };\n`, 'utf8');
      fs.writeFileSync(skeleton, `'use strict';\n\n// <swe-pro-generated src="${mainSrc}">\n// stale\n// </swe-pro-generated>\n`, 'utf8');
      const res = runBuilder(['--check', skeleton]);
      assert.notStrictEqual(res.status, 0, 'builder must fail when the required target has no region, got status 0');
      assert.ok(res.output.includes(`__${tag}_missing`), `failure names the missing target: ${res.output}`);
    } finally {
      try { fs.unlinkSync(missingAbs); } catch {}
      try { fs.unlinkSync(mainAbs); } catch {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
