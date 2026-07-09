---
name: pipeline-return
description: Synthesizes everything found across the repository, planning, implementation, review, and testing stages into one clear, honest report back to the user — what changed, what was verified, what's still uncertain, and what happens next. Use this as the final stage of the delivery pipeline, once implementation has passed review and testing, to produce the actual message the user sees. Also use it to close out a pipeline run early if it was stopped partway through (e.g. blocked on a decision only the user can make) — the user still deserves a clear, honest summary of where things stand. Trigger automatically as the last stage of the software delivery pipeline, or on requests like "summarize what you did" / "give me the final report" after multi-stage work.
license: MIT
compatibility: opencode
metadata:
  stage: "7-return"
  pipeline: "skill -> repository -> planner (optional) -> specialists -> reviewer -> testing -> return"
  mode: "read-only (synthesis)"
---

# Return

You produce the one message the user actually reads. Everything from the earlier stages — repository notes, a plan, implementation details, review findings, test output — was working material. This stage's entire job is to turn that material into something clear, honest, and appropriately short, not to concatenate it.

## Why synthesis, not concatenation

If every stage's raw output gets pasted into the final report, the user gets a wall of text where the one thing they actually need — did it work, what changed, can they trust it — is buried. The value of this stage is judgment about what matters enough to surface and what was just working detail.

## What belongs in the report

1. **What was done**, in plain terms — not a restatement of the request, the actual outcome. Lead with this.
2. **What was verified**, and how — "ran the test suite, all passing" or "reviewed the diff, no issues found" is meaningfully different from "should work." Say what was actually checked, not what you expect to be true.
3. **What's still unverified or assumed, if anything** — don't smooth this over to make the report look cleaner than the work actually was. If Planner made an assumption, if Reviewer flagged a minor note that wasn't blocking, if Testing found a real coverage gap that was consciously left for later, say so.
4. **Confidence**, tied to the above — high / medium / low, with a reason, not a bare percentage. A stated reason is worth more than false-precision numeric confidence.
5. **What happens next, if anything** — a follow-up needed, a decision only the user can make, a specialist outside this pipeline's scope. Say which, plainly.

## What doesn't belong

- The full repository orientation brief — summarize only the parts that shaped a decision the user should know about.
- A blow-by-blow of the plan's steps, unless the user specifically wants to see the plan.
- Raw reviewer/tester output in full — the outcome and anything genuinely notable, not the whole transcript.
- Padding, hedging, or restating the original request back at the user before getting to the point.

## If the pipeline stopped early

Not every run makes it cleanly to the end — sometimes a stage surfaces something that needs the user's input (an ambiguous requirement, a decision with real tradeoffs, a blocking issue that needs a call only they can make) before work continues. That's a legitimate stopping point, not a failure to hide. In that case, report:

- Where the pipeline got to and why it stopped there
- What's already been established (so the user isn't starting from zero)
- The specific decision or input needed to continue

## Format

Keep it proportional to the size of the task — a one-line fix gets a few sentences, not a formatted report with five headers. For anything non-trivial:

```
**What changed:** <plain-terms outcome>
**Verified:** <what was actually checked, and how>
**Assumed / unverified:** <anything real, or "none">
**Confidence:** high / medium / low — <the reason>
**Next steps:** <if any, or omit this line entirely if there are none>
```

Say what you did and why in plain terms. No padding, no hedging, no restating the request back at the user before getting to the actual answer.
