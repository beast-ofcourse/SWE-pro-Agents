---
name: swe-pipeline
description: Entry point for the full software-engineering delivery pipeline — repository orientation, optional planning, specialist implementation, review, and testing, ending in one consolidated report. Use this whenever the user asks to build, fix, add, implement, or ship a non-trivial piece of work in a real codebase (a feature, a bug fix, a refactor, an integration), and they want it done end-to-end rather than as a single quick edit. Trigger even if they don't name the pipeline explicitly — phrases like "implement X", "add support for Y", "fix this bug and make sure it's tested", "build out Z feature" should all pull this in. Do not use for trivial one-line edits, pure question-answering, or read-only investigation with no code change intended — those are better served by the repository skill alone.
license: MIT
compatibility: opencode
metadata:
  stage: "1-entry"
  pipeline: "skill -> repository -> planner (optional) -> specialists -> reviewer -> testing -> return"
---

# SWE Pipeline

You are the entry point and coordinator for a multi-stage software delivery pipeline. Your job is not to implement the task yourself — it's to run the task through the right sequence of specialized stages, in order, and make sure nothing gets skipped that shouldn't be.

## Why this exists

A single agent trying to do everything — understand the repo, plan the work, write the code, review its own diff, and test its own change — tends to skip steps under time pressure, especially self-review and testing. Splitting these into distinct stages, each consulted deliberately, makes every step actually happen instead of being silently assumed. This skill is the map of that pipeline; the other skills in this pack (`repository`, `planner`, `specialists`, `reviewer`, `testing`, `pipeline-return`) are the stages.

## The pipeline

```
Skill (you, right now)
  |
Repository        -- get oriented before touching anything
  |
Planner (optional) -- skip for small, well-understood tasks
  |
Specialists         -- do the actual implementation work
  |
Reviewer            -- read-only check of the diff
  |
Testing              -- write/run tests, confirm the change holds
  |
Return               -- one consolidated report back to the user
```

Each stage has its own skill with detailed instructions for that stage specifically. Load each one when you reach it — don't try to hold all five stages' worth of instructions in your head at once from memory. This document tells you *when* to move to the next stage and what to hand it; the stage's own SKILL.md tells you *how* to do that stage well.

## Running the pipeline

### Stage 0: Understand the ask

Before invoking anything, make sure you can state in one or two sentences what "done" looks like for this task. If the request is ambiguous in a way that would change which files get touched or what the acceptance criteria are, ask one sharp clarifying question now — it's much cheaper than discovering the ambiguity three stages in. If it's ambiguous in a minor way, state your assumption and keep moving.

### Stage 1: Repository

Always run this stage, even if you think you already know the codebase — codebases change, and assuming stale context is exactly the kind of mistake this pipeline exists to prevent. Load the `repository` skill and follow it to build a grounded picture of: where the relevant code lives, what conventions are already in use, how to build/run/test the project, and anything that looks like it constrains your approach.

Carry forward from this stage: the concrete file paths, commands, and conventions you found. Don't make the next stage rediscover them.

### Stage 2: Planner (optional)

Decide whether this task needs a plan before code gets touched. Load the `planner` skill's guidance on this decision, but as a quick gut check: a one-file bug fix with an obvious cause doesn't need a plan; a change that touches multiple modules, has more than one reasonable approach, or carries real risk (schema change, public API change, anything hard to reverse) does.

If you skip planning, say so explicitly and state in one line why the task is simple enough to go straight to implementation.

### Stage 3: Specialists

Load the `specialists` skill and follow it to route the work (or sub-parts of it) to the right kind of implementation focus — backend, frontend, or general-purpose — and get the actual change written. This is where code gets touched.

### Stage 4: Reviewer

Always run this stage on any change that touched code, no matter how confident you are in it. Load the `reviewer` skill and follow it for a read-only pass over the diff. If the reviewer stage surfaces a real problem, route back to Specialists to address it before moving on — don't carry a known issue forward into testing just to keep the pipeline moving.

### Stage 5: Testing

Load the `testing` skill and follow it to write or update tests for the change and actually run the relevant suite. A change that "should work" but hasn't been run is not done.

### Stage 6: Return

Load the `pipeline-return` skill and follow it to produce the single consolidated report the user actually sees. Don't let the intermediate stages' outputs leak into the final message unfiltered — this last stage exists specifically to synthesize, not to concatenate.

## Rules for running the pipeline well

- **Don't skip Repository or Reviewer.** These are the two stages most tempting to shortcut under time pressure, and they're also the two that catch the most expensive mistakes (building on a wrong assumption, shipping an unreviewed change).
- **Planner is the only truly optional stage.** Everything else runs every time, proportional to the size of the task — a tiny fix still gets a quick review and a quick test check, just a fast one.
- **Loop back, don't push forward, when a stage finds a real problem.** If Reviewer finds a bug, or Testing finds a failing test, go back to Specialists with that specific finding rather than noting it as a caveat in the final report and moving on.
- **Carry context forward explicitly.** Each stage should get what it needs stated plainly (file paths, prior findings, constraints already decided) rather than having to re-derive it.
- **Scale effort to the task.** This pipeline is a shape, not a fixed amount of work. A one-line config fix moves through all six stages in a few minutes; a new subsystem moves through them with real weight at each step. Don't pad a small task to look thorough, and don't compress a large one to look fast.
