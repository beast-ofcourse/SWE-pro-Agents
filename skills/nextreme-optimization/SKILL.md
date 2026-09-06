---
name: nextreme-optimization
description: Use when the user explicitly asks for maximum performance — "make this as fast as possible," "blazing fast," "squeeze every bit out" — or when profiling reveals a bottleneck worth killing. Measures first, fixes in impact order, keeps only what beats noise, guards the win in CI. Not for routine refactors, style cleanup, or working-code requests: this skill trades readability for measured speed, and says so upfront.
license: MIT
---

# Nextreme-Optimization

Directive, not tutorial. When invoked, stop treating performance as one
concern among several (readability, idiom, maintainability) and treat it as
**the** concern. Readability is the first thing to give up. Idiomatic style
is the second. Correctness is never on that list — see Hard Floor below.

Sources (both MIT): workflow, verification discipline, and fix catalog
adapted from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
`performance-optimization`; metrics-first doctrine and candidate discipline
from [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills);
rule style from its `react-best-practices`.

## Hard floor (non-negotiable, checked before and after every change)

These are the boundary that makes "extreme" mean *extreme performance*,
not *extreme recklessness*.

1. **Behavior is preserved.** Same inputs → same outputs, same observable
   side effects, same errors in the same cases. An optimization that changes
   behavior at any edge case (overflow, empty input, null, concurrent access,
   locale, timezone, encoding) does not ship — fix the edge explicitly and
   note it, or discard the optimization.
2. **No silently dropped safety checks.** Bounds, null, overflow, and input
   validation go only with a *proof* of unreachability from the type system
   or a caller invariant, stated explicitly in the change notes — never a
   silent deletion.
3. **No claimed win without a measurement.** "Should be faster" is not a
   result. Every shipped optimization carries a before/after benchmark on
   realistic input sizes. Unmeasurable here → label it *reasoned-but-
   unverified*, never a completed win.
4. **Concurrency changes get extra scrutiny.** Lock removal, atomics,
   lock-free structures, and cross-thread reordering are correctness changes
   wearing a performance costume. "It ran fine" is not proof — demonstrate
   the invariant or don't make the change.

A request that needs 1 or 2 crossed to hit a target stops there, loudly.

## Workflow: measure → identify → fix → verify → guard

### 1. Measure (baseline first, no exceptions)

No baseline, no optimization — there is no other way to know a change
helped. Capture timing, profiler output, or memory footprint on realistic
input sizes before touching code.

Let the symptom pick the instrument:

```
What is slow?
├── First load ......... bundle size / TTFB waterfall / render-blocking resources
├── Interaction ........ main-thread long tasks (>50ms) / re-renders / layout thrash
├── After navigation ... API times + waterfalls / client render cost / N+1 fetches
└── Backend/API ........ query log + EXPLAIN / pool wait / CPU + heap profiles
```

Rules: synthetic (Lighthouse, DevTools, `console.time`, query log) for
reproducibility + CI; field data (RUM, APM, slow-query log) to confirm users
feel it. Same command, same conditions, fixed budget — a cold-cache baseline
against a warm-cache result measures the cache, not the change.

### 2. Identify (profile, don't guess)

Fix only what measurement proves is the bottleneck. Then work the priority
tiers top-down — one algorithmic fix usually beats every micro-optimization
below it combined:

**1. Algorithmic complexity.** Nested loops over one collection, repeated
linear search where a lookup fits, recomputation across calls, needless
sorts, quadratic string building.
**2. Work elimination.** Fastest code doesn't run: memoize pure/stable work,
hoist loop-invariants, short-circuit early, lazy evaluation, dead branches,
batch repeated I/O into one call.
**3. Data layout & memory traffic.** Contiguous over pointer-chasing,
right-size containers up front, reuse buffers / pool objects, kill needless
copies. Allocation pressure and cache misses first, cleverness never.
**4. Concurrency & parallelism.** Only after 1–3 — parallelizing waste just
wastes cores faster. Vectorize/SIMD where supported, parallelize independent
work, overlap latency with async I/O, size pools to the bottleneck (more
threads ≠ faster).
**5. Micro-optimizations.** Last, profile-justified only: unrolling, bit
tricks, inlining hot tiny functions, redundant conversions. Most likely to
trade readability for nothing — the verification loop below exists largely
for this tier.

Scope discipline (from the metrics-first school): investigate only the
candidate the measurement names. No repo-wide grep expeditions, no drive-by
"while I'm here" speedups outside the bottleneck.

### 3. Fix (one bottleneck, one change, known patterns)

Change one tier's worth at a time — if something regresses you must know
which change did it. Reach for proven patterns first:

**N+1 queries.** One query per row → a single join/include. Paginate every
list endpoint (`take`/`skip`, never unbounded `findMany`).

**Queries ignoring their index.** The plan is the measurement —
`EXPLAIN ANALYZE` before and after. Index the *shape* of the query
(equality columns first, then range/sort: `(owner_id, created_at DESC)`),
not the column in isolation. Know when indexes lose: dominant-value
filters, leading wildcards, functions on columns, write-heavy tables
(every index taxes every write — measure that cost too). An index that
didn't change the plan is a revert.

**Connection pools.** One pool per process, sized against the database
ceiling (`instances × max < max_connections`), fail-fast timeouts. A pool
bigger than the database can execute just moves the queue somewhere
invisible — under autoscaling, multiplex (pgbouncer/RDS Proxy), don't raise
`max`. Every-endpoint-slow + idle database = pool exhaustion, not slow
queries.

**Caching — deliberate or not at all.** Cache what is expensive *and*
re-read far more than written. Pick one layer (in-process LRU / shared
Redis / CDN) and one invalidation story (TTL with a stated staleness
window, event/tag, or versioned keys). Key on every input that changes the
response (tenant, locale, viewer — a key that omits the viewer serves one
user's data to another). Coalesce concurrent misses; serve stale while one
request recomputes. Never cache balances, permissions, or checkout
inventory — staleness there is a correctness bug, not a tradeoff.

**Frontend weight.** Route-split + lazy-load heavy features; stabilize
references (`memo`/`useMemo` where profiling points, not everywhere);
images with dimensions, modern formats, lazy below the fold, priority on
the LCP image; kill waterfalls before micro-tuning renders.

**Data movement.** Fewer, bigger I/O batches; stream instead of buffering
whole payloads; avoid serializing twice across a boundary.

### 4. Verify (keep or revert — neutral is a revert)

Re-measure exactly like the baseline, then decide strictly:

| Result vs. baseline | Action |
|---|---|
| Past the threshold, tests green | **Keep.** Commit with before/after numbers in the message. |
| Within run-to-run variance | **Revert.** A 3% gain inside ±5% noise is a different sample, not a win. |
| Worse | **Revert.** |
| Improved, but a test went red | **Revert.** A regression wearing a win's clothing. |

Unwritten work rots: log every attempt — kept *and* reverted — with
baseline → result, verdict, and one-line why (PR description or `PERF.md`).
A discarded idea stays discarded only if the next agent can read that it
already failed. Report regressions too, not just wins.

Then re-check the hard floor: re-run tests and edge cases *after*
optimizing. Optimizations break exactly the edge they didn't consider.

### 5. Guard (make the win survive the next PR)

Guard the metric the user feels, with the same instrument that justified
the fix:

```
JavaScript bundle ..... < 200KB gzipped (initial)      API p95 ......... < 200ms
CSS ................... < 50KB gzipped                 Images .......... < 200KB each (above fold)
Fonts ................. < 100KB total                  Lighthouse ...... ≥ 90
Time to Interactive ... < 3.5s on 4G
```

- **Synthetic CI gate** (bundlesize, Lighthouse CI): catches reproducible
  regressions pre-merge. Compare medians/trends so normal variance doesn't
  make the gate flaky.
- **Field monitor** (RUM p75, APM, slow-query alerts): confirms users kept
  the win. Either guard firing sends you back to step 1 with a fresh
  baseline — never straight to another fix.

## Output format

- **What changed and why**, tier by tier in priority order — not a flat diff.
- **Measured impact** per change (baseline → result, input size, harness),
  or explicit `unverified, reasoning: …`.
- **Anything discarded for crossing the hard floor**, one line each —
  signal, not noise, especially when the user hoped for that technique.
- **The attempt ledger**, kept and reverted alike.
- **Remaining bottleneck**, if any — extreme work rarely finishes in one
  pass; say what the next profile would point to.

## Rationalizations (heard before, wrong every time)

| "…" | Reality |
|---|---|
| It's fast on my machine | Your machine isn't the user's. Representative hardware or it didn't happen. |
| This optimization is obvious | Then measuring it is cheap. Unmeasured wins are how neutral complexity lands. |
| Just add an index | Read the plan first — and price the write tax. |
| Just cache it | Caching a cheap call buys a staleness bug for nothing. |
| Raise the pool size | Find what's holding connections instead. |
| It didn't help, but doesn't hurt | Neutral is a revert. You maintain everything you keep. |
| We already wrote it, keep it | Sunk cost. The measurement doesn't care about effort. |
| No need to re-measure | Re-measuring an obvious win costs minutes and proves it. |
| A test had to change for the win | Then it wasn't a win. Revert. |

## Red flags (stop and re-measure)

Optimization without a profile · N+1 in new fetching code · index without
before/after plans · cache key missing an input · cache with no staleness
story · pool raised on exhaustion · unbounded lists · images without
dimensions · `memo`/`useMemo` everywhere · bundled changes under one
measurement · reverted ideas with no ledger entry · same dead idea tried
twice.

## Explicit non-goals

- Not style/idiom work. Idioms welcome when fast; discarded without
  ceremony when not.
- Not a rewrite-in-another-language skill. Same runtime unless asked.
- Not performance theater. No change that reads aggressive without moving
  the measured number.
- Not platform-locked. No vendor metrics, CLIs, or dashboards required —
  every step works with a timer, a profiler, and the repo's own tests.
