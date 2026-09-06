'use strict';

// ---------------------------------------------------------------------------
// Deep module: background-scheduler (per-key concurrency + fair-share)
// ---------------------------------------------------------------------------
const SCHEDULER_DEFAULT_PER_KEY = 5;
const SCHEDULER_DEFAULT_MAX_PARALLEL = 4;
const SCHEDULER_DEFAULT_FAIR_SHARE = 0.75;
const SCHEDULER_DEFAULT_BACKOFF_BASE = 5000;
const SCHEDULER_DEFAULT_BACKOFF_MAX = 120000;
const SCHEDULER_DEFAULT_TOKEN_BUDGET = 200000;
const SCHEDULER_DEFAULT_CB_THRESHOLD = 5;
const RATE_LIMIT_PATTERN = /429|rate.?limit|5\d\d/i;

function keyFor(delegation) {
  const model = delegation ? delegation.model : null;
  const provider = delegation ? delegation.provider : null;
  if (model) {
    const text = String(model);
    if (text.indexOf('/') !== -1) return text;
    if (provider) return String(provider) + '/' + text;
    return text;
  }
  if (provider) return String(provider);
  return 'default';
}

function createScheduler(deps) {
  const env = (deps && deps.env) || process.env;
  const perKeyLimit = parseInt(env.SWE_PRO_BG_PER_KEY, 10) || SCHEDULER_DEFAULT_PER_KEY;
  const maxParallel = parseInt(env.SWE_PRO_BG_MAX_PARALLEL, 10) || SCHEDULER_DEFAULT_MAX_PARALLEL;
  const fairShare = parseFloat(env.SWE_PRO_BG_FAIR_SHARE) || SCHEDULER_DEFAULT_FAIR_SHARE;
  const backoffBase = parseInt(env.SWE_PRO_BG_BACKOFF_BASE, 10) || SCHEDULER_DEFAULT_BACKOFF_BASE;
  const backoffMax = parseInt(env.SWE_PRO_BG_BACKOFF_MAX, 10) || SCHEDULER_DEFAULT_BACKOFF_MAX;
  const tokenBudget = parseInt(env.SWE_PRO_BG_TOKEN_BUDGET, 10) || SCHEDULER_DEFAULT_TOKEN_BUDGET;
  const cbThreshold = parseInt(env.SWE_PRO_BG_CB_THRESHOLD, 10) || SCHEDULER_DEFAULT_CB_THRESHOLD;
  const slots = [];
  const activeByKey = Object.create(null);
  const activeByParent = Object.create(null);
  // T-022 backpressure state (per key, in-memory only):
  // - backoffUntil[key]: Date.now() timestamp until which acquire() refuses
  //   that key with {ok:false, reason:'backoff'} (429-storm: queued tasks wait,
  //   no crash, no silent drop).
  // - backoffAttempts[key]: consecutive rate-limit noteError count for the key.
  //   Exact semantics: incremented on each matching noteError; reset to zero on
  //   the next successful acquire() for that key AND on any noteTokens() call
  //   for that key (successful spawn). The backoff window itself is NOT cleared
  //   early — acquire stays backed off until now >= backoffUntil[key]. Delay
  //   for error N (0-based) is min(base * 2^N, max).
  // - estimatedTokens[key]: accumulated best-effort token estimate per key;
  //   soft only — acquire refuses with {ok:false, reason:'budget'} while over
  //   budget, and the counter resets when the key drains (no active slots left
  //   after release()).
  const backoffUntil = Object.create(null);
  const backoffAttempts = Object.create(null);
  const estimatedTokens = Object.create(null);
  // T-023 spawn circuit breaker (per key, in-memory only):
  // - circuitConsecutive[key]: consecutive spawn failures for the key (any
  //   error, not just rate limits — unlike noteError/backoff). Reset to zero
  //   by noteSpawnSuccess while the circuit is closed.
  // - circuitOpen[key]: true once circuitConsecutive reaches cbThreshold
  //   (env SWE_PRO_BG_CB_THRESHOLD, default 5). While open, acquire() refuses
  //   that key with {ok:false, reason:'circuit_open'} (other keys unaffected).
  // - Half-close (exact): an open circuit admits exactly ONE trial acquire —
  //   the first acquire while open with no trial outstanding passes through
  //   to the normal admission checks and, when admitted, marks
  //   circuitTrialInFlight[key]; any further acquire while the trial is
  //   outstanding returns circuit_open. Trial spawn success
  //   (noteSpawnSuccess) fully closes the circuit AND resets the consecutive
  //   counter (as does any other spawn success while open — a success resets
  //   the key); trial spawn failure (noteSpawnFailure) clears the trial flag
  //   and keeps the circuit open (the next acquire may trial again).
  const circuitConsecutive = Object.create(null);
  const circuitOpen = Object.create(null);
  const circuitTrialInFlight = Object.create(null);

  function normalizeKey(key) {
    return typeof key === 'string' && key ? key : 'default';
  }

  function heldByKey(slotKey) {
    return activeByKey[slotKey] || 0;
  }

  function heldByParent(parentID) {
    return activeByParent[parentID] || 0;
  }

  function acquire(key, parentID) {
    const slotKey = normalizeKey(key);
    const now = Date.now();
    // T-023 circuit breaker: open circuits refuse, except the single
    // half-open trial (first acquire with no trial outstanding falls through
    // to the normal checks below and marks the trial when admitted).
    const circuitIsOpen = !!circuitOpen[slotKey];
    if (circuitIsOpen && circuitTrialInFlight[slotKey]) return { ok: false, reason: 'circuit_open' };
    const circuitTrial = circuitIsOpen && !circuitTrialInFlight[slotKey];
    const until = backoffUntil[slotKey];
    if (typeof until === 'number') {
      if (now < until) return { ok: false, reason: 'backoff' };
      delete backoffUntil[slotKey];
    }
    if ((estimatedTokens[slotKey] || 0) > tokenBudget) return { ok: false, reason: 'budget' };
    if (heldByKey(slotKey) >= perKeyLimit) return { ok: false, reason: 'per_key' };
    if (slots.length >= maxParallel) return { ok: false, reason: 'global' };
    // Fair-share: a single parentID holds at most ceil(maxParallel * fairShare).
    // Accepted tradeoff (T-021): with maxParallel=4 a parent is capped at 3,
    // so a parent can be partially starved while 1 slot stays free — that
    // headroom guarantees other parents can always make progress, and is
    // intended.
    if (parentID !== null && parentID !== undefined) {
      const fairCap = Math.ceil(maxParallel * fairShare);
      if (heldByParent(parentID) >= fairCap) return { ok: false, reason: 'fair_share' };
    }
    slots.push({ key: slotKey, parentID: parentID == null ? null : parentID });
    activeByKey[slotKey] = heldByKey(slotKey) + 1;
    if (parentID !== null && parentID !== undefined) activeByParent[parentID] = heldByParent(parentID) + 1;
    if (backoffAttempts[slotKey]) delete backoffAttempts[slotKey];
    // T-023: this admission is the half-open trial — concurrent acquires stay
    // circuit_open until the trial spawn reports success/failure. Consecutive
    // failure counters reset only via noteSpawnSuccess, never here, so a
    // burst of acquires cannot mask a failing key.
    if (circuitTrial) circuitTrialInFlight[slotKey] = true;
    return { ok: true };
  }

  function noteError(key, err) {
    try {
      const slotKey = normalizeKey(key);
      let message = '';
      try {
        if (err && typeof err.message === 'string') message = err.message;
        else message = String(err);
      } catch {
        message = '';
      }
      if (!RATE_LIMIT_PATTERN.test(message)) return { backedOff: false };
      const attempt = backoffAttempts[slotKey] || 0;
      const delay = Math.min(backoffBase * Math.pow(2, attempt), backoffMax);
      backoffUntil[slotKey] = Date.now() + delay;
      backoffAttempts[slotKey] = attempt + 1;
      return { backedOff: true, retryAfterMs: delay };
    } catch {
      return { backedOff: false };
    }
  }

  function noteTokens(key, n) {
    try {
      const slotKey = normalizeKey(key);
      const count = Number(n);
      if (!Number.isFinite(count) || count <= 0) return { ok: false };
      estimatedTokens[slotKey] = (estimatedTokens[slotKey] || 0) + count;
      if (backoffAttempts[slotKey]) delete backoffAttempts[slotKey];
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // T-023 spawn circuit breaker: every spawn failure counts (unlike
  // noteError, which only backs off rate-limit-shaped messages). At threshold
  // consecutive failures the circuit opens; the delegate calls this from its
  // spawn-failure paths and noteSpawnSuccess on spawn success. Never throws.
  function noteSpawnFailure(key) {
    try {
      const slotKey = normalizeKey(key);
      const consecutive = (circuitConsecutive[slotKey] || 0) + 1;
      circuitConsecutive[slotKey] = consecutive;
      // A failed trial frees the trial slot but keeps the circuit open, so
      // the next acquire may attempt exactly one fresh trial.
      if (circuitTrialInFlight[slotKey]) delete circuitTrialInFlight[slotKey];
      if (consecutive >= cbThreshold) circuitOpen[slotKey] = true;
      return { open: !!circuitOpen[slotKey], consecutive };
    } catch {
      return { open: false, consecutive: 0 };
    }
  }

  // T-023 half-close resolution: a success resets the key. An open circuit
  // fully closes (the half-open trial succeeded, or an in-flight spawn
  // admitted before opening proved the key healthy again) and consecutive
  // counters reset either way — "a success resets it". Never throws.
  function noteSpawnSuccess(key) {
    try {
      const slotKey = normalizeKey(key);
      const wasOpen = !!circuitOpen[slotKey];
      delete circuitOpen[slotKey];
      delete circuitTrialInFlight[slotKey];
      delete circuitConsecutive[slotKey];
      return { closed: wasOpen };
    } catch {
      return { closed: false };
    }
  }

  function release(key, parentID) {
    const slotKey = normalizeKey(key);
    let index = -1;
    for (let i = slots.length - 1; i >= 0; i -= 1) {
      if (slots[i].key !== slotKey) continue;
      if (parentID !== null && parentID !== undefined && slots[i].parentID !== parentID) continue;
      index = i;
      break;
    }
    if (index === -1) return { ok: false };
    const removed = slots.splice(index, 1)[0];
    const keyLeft = heldByKey(removed.key) - 1;
    if (keyLeft <= 0) delete activeByKey[removed.key];
    else activeByKey[removed.key] = keyLeft;
    if (removed.parentID !== null && removed.parentID !== undefined) {
      const parentLeft = heldByParent(removed.parentID) - 1;
      if (parentLeft <= 0) delete activeByParent[removed.parentID];
      else activeByParent[removed.parentID] = parentLeft;
    }
    // Soft budget resets when the key drains: no active slots left for it.
    if (!activeByKey[removed.key] && estimatedTokens[removed.key]) delete estimatedTokens[removed.key];
    return { ok: true };
  }

  function keys() {
    const seen = [];
    for (const slot of slots) {
      if (seen.indexOf(slot.key) === -1) seen.push(slot.key);
    }
    return seen;
  }

  // Crash-recovery hook: drops concurrency accounting only — backoff windows,
  // attempt counters, soft token estimates, and spawn-circuit state are
  // preserved (the supervisor
  // calls reset() every reconcile; wiping throttles there would defeat T-022).
  // The delegate calls reset() at the top of
  // reconcileOrphans, then re-acquires one slot per live running delegation,
  // so a stale in-memory count (e.g. after an unclean restart where the
  // running set was rebuilt from disk) can never pin the global cap forever.
  function reset() {
    slots.length = 0;
    for (const name of Object.keys(activeByKey)) delete activeByKey[name];
    for (const name of Object.keys(activeByParent)) delete activeByParent[name];
  }

  return { acquire, release, keys, reset, keyFor, noteError, noteTokens, noteSpawnFailure, noteSpawnSuccess };
}

module.exports = { createScheduler, keyFor };
