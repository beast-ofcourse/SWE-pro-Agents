'use strict';

// ---------------------------------------------------------------------------
// Deep module: background-results (typed result registry + secret redaction)
// ---------------------------------------------------------------------------
const SECRET_PATTERN = /(api[_-]?key|secret|token|password|authorization)["']?\s*[:=]\s*['"]?[^\s'"]+/gi;
const SECRET_KEY_PATTERN = /(api[_-]?key|secret|token|password|authorization)/i;
const SUMMARY_MAX_LENGTH = 2000;
const REDACTED_TOKEN = '<redacted>';

const schemas = Object.create(null);

function registerSchema(agent, validate) {
  schemas[agent] = validate;
}

function validateResult(agent, raw) {
  try {
    if (!Object.prototype.hasOwnProperty.call(schemas, agent)) {
      const text = String(raw || '');
      return { kind: 'generic', summary: text.slice(0, SUMMARY_MAX_LENGTH), markdown: text };
    }
    const validate = schemas[agent];
    let outcome;
    try {
      outcome = validate(raw);
    } catch (err) {
      return { kind: 'invalid', error: err && err.message ? err.message : String(err), raw };
    }
    if (outcome && outcome.ok) return { kind: 'typed', value: outcome.value };
    const error = outcome && outcome.error !== undefined ? outcome.error : 'validation failed';
    return { kind: 'invalid', error, raw };
  } catch (err) {
    return { kind: 'invalid', error: err && err.message ? err.message : String(err), raw };
  }
}

function redact(text) {
  try {
    if (typeof text !== 'string') return text;
    return text.replace(SECRET_PATTERN, REDACTED_TOKEN);
  } catch {
    return text;
  }
}

function redactDeep(value) {
  try {
    if (typeof value === 'string') return redact(value);
    if (Array.isArray(value)) return value.map((item) => redactDeep(item));
    if (value !== null && typeof value === 'object') {
      if (value instanceof Date || value instanceof RegExp) return value;
      const out = {};
      for (const key of Object.keys(value)) {
        const prop = value[key];
        if (typeof prop === 'string') out[key] = SECRET_KEY_PATTERN.test(key) ? REDACTED_TOKEN : redact(prop);
        else if (Array.isArray(prop)) out[key] = redactDeep(prop);
        else if (prop !== null && typeof prop === 'object' && !(prop instanceof Date) && !(prop instanceof RegExp)) out[key] = redactDeep(prop);
        else out[key] = prop;
      }
      return out;
    }
    return value;
  } catch {
    return value;
  }
}

module.exports = { registerSchema, validateResult, redact, redactDeep };
