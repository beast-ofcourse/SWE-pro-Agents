'use strict';

/**
 * background-results.test.js — plain-node tests for the typed result registry
 * and secret redaction in scripts/background-results.js.
 */

const assert = require('assert');
const { registerSchema, validateResult, redact, redactDeep } = require('../scripts/background-results.js');

async function run() {
  let passed = 0;
  let failed = 0;

  function check(name, fn) {
    return fn()
      .then(() => {
        console.log('PASS  ' + name);
        passed += 1;
      })
      .catch((err) => {
        console.log('FAIL  ' + name + ': ' + err.message);
        failed += 1;
      });
  }

  await check('typed result for known agent', async () => {
    registerSchema('typed-agent', (raw) => ({ ok: true, value: { answer: raw } }));
    const res = validateResult('typed-agent', 'hello');
    assert.strictEqual(res.kind, 'typed', 'kind should be typed');
    assert.deepStrictEqual(res.value, { answer: 'hello' }, 'value should pass through');
  });

  await check('generic result for unknown agent', async () => {
    const res = validateResult('unknown-agent-xyz', 'some text');
    assert.strictEqual(res.kind, 'generic', 'kind should be generic');
    assert.strictEqual(res.summary, 'some text', 'summary should match input');
    assert.strictEqual(res.markdown, 'some text', 'markdown should match input');
  });

  await check('invalid result when validate fails', async () => {
    registerSchema('strict-agent', () => ({ ok: false, error: 'bad shape' }));
    const res = validateResult('strict-agent', 'raw-input');
    assert.strictEqual(res.kind, 'invalid', 'kind should be invalid');
    assert.strictEqual(res.error, 'bad shape', 'error should pass through');
    assert.strictEqual(res.raw, 'raw-input', 'raw should be preserved');
  });

  await check('redact masks api_key', async () => {
    assert.strictEqual(redact('api_key=abc123'), '<redacted>', 'secret assignment should be masked');
  });

  await check('redactDeep masks nested secrets', async () => {
    const input = { name: 'api_key=abc123', nested: { auth: 'token=xyz' }, list: ['password=secret123', 42] };
    const out = redactDeep(input);
    assert.strictEqual(out.name, '<redacted>', 'top-level string should be masked');
    assert.strictEqual(out.nested.auth, '<redacted>', 'nested string should be masked');
    assert.strictEqual(out.list[0], '<redacted>', 'array string should be masked');
    assert.strictEqual(out.list[1], 42, 'non-string array entry should stay intact');
    assert.strictEqual(input.name, 'api_key=abc123', 'input should not be mutated');
  });

  await check('redact returns non-string unchanged', async () => {
    assert.strictEqual(redact(42), 42, 'number should pass through');
    assert.strictEqual(redact(null), null, 'null should pass through');
    assert.strictEqual(redactDeep(42), 42, 'redactDeep number should pass through');
    assert.strictEqual(redactDeep(null), null, 'redactDeep null should pass through');
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('test harness error:', err);
  process.exit(1);
});
