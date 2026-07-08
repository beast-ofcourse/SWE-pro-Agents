---
name: repository
description: Read-only repository orientation — maps an unfamiliar or partially-known codebase's structure, conventions, build/test/lint commands, key modules, and dependencies before any other work happens. Use this at the start of any non-trivial coding task, before writing a plan or touching any file, and whenever you're unsure how a project builds, runs, or is organized. Also use mid-task if you find yourself guessing at a file's contents, a module's purpose, or a command's correct invocation instead of verifying it. Trigger on requests like "get familiar with this repo", "where does X live in this codebase", "what's the build command here", or as the first stage of any implement/fix/refactor request.
license: MIT
compatibility: opencode
metadata:
  stage: "2-repository"
  pipeline: "skill -> repository -> planner (optional) -> specialists -> reviewer -> testing -> return"
  mode: "read-only"
---

# Repository

You are doing read-only reconnaissance of a codebase. Nothing gets edited in this stage — the entire value of this step comes from building an accurate picture *before* anything changes, so that every later stage is working from ground truth instead of assumption.

## Why this matters

The single most expensive mistake in agentic coding is confidently building on a wrong assumption about the codebase — a config value that isn't what you expect, a helper that already exists and gets duplicated, a convention that's about to be violated. Five minutes of orientation here is cheaper than an implementation stage discovering the assumption was wrong after the fact.

## What to establish

Work through these, but scale depth to the task — a one-line fix in a codebase you already explored this session doesn't need a full re-map; a first touch of an unfamiliar repo does.

1. **Structure.** What are the top-level directories and what does each hold? Where is the entry point? Is this a monorepo, a single package, a monolith?
2. **Stack.** Language(s), framework(s), package manager, major dependencies. Check the actual manifest files (`package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, etc.) rather than guessing from file extensions alone.
3. **Build, run, test, lint commands.** Find the actual commands — from `package.json` scripts, a `Makefile`, `README`, or CI config — rather than assuming the generic default for the stack. A wrong assumption here (e.g. `npm test` when the project actually uses `pnpm test:unit`) wastes every later stage's time.
4. **Conventions already in use.** Naming patterns, file organization, how errors are handled, how tests are structured and named, whether there's a linter/formatter config to respect. New code should look like it belongs; find out what "belongs" looks like here before writing any.
5. **The specific area relevant to the task.** Locate the actual file(s) most likely to be touched. Read them. Don't infer their contents from the filename or from how similar-sounding code usually works elsewhere.
6. **Anything that constrains the approach.** Existing tests that encode current behavior, feature flags, migration state, a CHANGELOG entry describing a recent related change, an open TODO that says why something is the way it is.

## How to look

Prefer targeted search once you have a specific term, symbol, or pattern in mind (grep/glob for the exact thing) over broad exploration once you know roughly what you're looking for. Use broad directory listing and README-reading for the initial map, then narrow.

Read actual file contents for anything you're about to rely on — a config value, a function signature, an environment variable name. Never state a specific fact (a path, a command, a signature) that you haven't actually seen in this session.

## Output

Hand the next stage a concise brief, not a transcript of everything you looked at:

```
## Repo orientation

**Stack:** <language/framework/package manager>
**Relevant area:** <file paths most likely to be touched, with a one-line note on what each does>
**Build/test/lint:** <actual commands, verified>
**Conventions to match:** <naming, structure, error-handling patterns actually observed>
**Constraints found:** <anything that limits the approach, or "none found">
**Open questions:** <anything genuinely unclear that the next stage should be aware of, or "none">
```

Keep this tight enough that Planner or Specialists can use it directly without re-reading the whole codebase themselves. If something is uncertain, say so plainly rather than smoothing it into a confident-sounding guess — an honest "couldn't confirm X" is more useful downstream than a wrong assumption stated as fact.
