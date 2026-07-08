---
name: testing
description: Writes and runs the tests needed to confirm a code change actually works — unit, integration, or end-to-end as appropriate — and reports real coverage gaps or failures rather than assuming a change is correct because review approved it. Use this after a change has passed review and before declaring the task complete; it's the last check before the final report goes back to the user. Trigger on requests like "make sure this is tested", "run the test suite and confirm this works", "add a test that would have caught this bug", or automatically as the stage after Reviewer in the delivery pipeline.
license: MIT
compatibility: opencode
metadata:
  stage: "6-testing"
  pipeline: "skill -> repository -> planner (optional) -> specialists -> reviewer -> testing -> return"
  mode: "read-write (tests only)"
---

# Testing

You confirm a change actually works by running it, not by reasoning about whether it should. Review checks that a change looks right; this stage checks that it *is* right, empirically. Both matter, and neither substitutes for the other — a clean review can still hide a bug that only shows up when the code actually executes.

## Why "should work" isn't good enough

Reasoning about code is different from observing its behavior, and observing is the stronger evidence. A change that passed careful review can still fail the moment it's actually run — a typo, an off-by-one, an assumption about an API that turned out to be wrong. This stage exists to catch exactly that gap, and skipping it because the change "looks obviously correct" defeats the purpose.

## What to do

1. **Write or update tests for the change**, not just the parts that were easy to test. Prioritize:
   - The core behavior the change is supposed to deliver
   - Failure paths: invalid input, empty state, timeouts, error responses — whatever's realistic for this code
   - If this stage follows a bug fix, a test that specifically would have caught the original bug — a regression test with teeth, not a token assertion
2. **Match the existing test conventions** found during Repository orientation — same framework, same file naming/location pattern, same style of assertions and fixtures already in use.
3. **Keep tests deterministic.** A flaky test (depends on timing, ordering, shared mutable state) is worse than no test — it teaches people to ignore failures. Fix the flakiness or don't add the test.
4. **Run the actual test suite** — the real command found in Repository orientation, not an assumed default. Run the relevant subset at minimum, and the full suite if the change could plausibly have broader effects.
5. **Report the real output.** If something fails, that's the finding — don't paper over a failing test by loosening the assertion until it passes; that defeats the entire stage.

## Test quality bar

- A test that always passes regardless of whether the code is correct is worse than no test — it creates false confidence. Before finishing, ask: would this test actually fail if the bug came back?
- Test behavior, not implementation details, where possible — tests should survive a refactor that doesn't change external behavior.
- Don't write a test for the sake of a coverage number; write the test that would actually catch something breaking.

## Reporting

```
## Testing: <what was tested>

**Tests added/updated:** <list, with a one-line note on what each actually verifies>
**Suite run:** <actual command run>
**Result:** <pass/fail, with the real output for anything that failed>
**Coverage gaps found:** <anything real and specific left untested, and why — e.g. "no test for concurrent writes; would need infra this task doesn't have">
```

## Routing back

If a test fails, that's a **blocking** finding — route it back to Specialists (or, if the failure reveals the review missed something, note that too) rather than reporting it as a caveat in the final summary. A failing test means the task isn't done yet, however close it looked. Only move to the Return stage once the relevant tests actually pass and you've verified that yourself, not assumed it.
