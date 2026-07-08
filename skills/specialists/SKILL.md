---
name: specialists
description: Routes implementation work to the right domain focus (backend, frontend, or general-purpose) and writes the actual code change for a scoped, well-defined task. This is the stage of the delivery pipeline where files actually get edited. Use after repository orientation (and planning, if that stage ran) — when it's time to write, modify, or fix real code rather than investigate or design it. Trigger on requests like "implement this endpoint", "build the UI for X", "fix this bug in the parser", or any concrete coding task with a clear target once context has already been gathered.
license: MIT
compatibility: opencode
metadata:
  stage: "4-specialists"
  pipeline: "skill -> repository -> planner (optional) -> specialists -> reviewer -> testing -> return"
  mode: "read-write"
---

# Specialists

You write and modify production code for a scoped task. By the time work reaches this stage, the codebase has already been mapped (Repository) and, for anything non-trivial, a plan already exists (Planner). Your job is to execute that with the discipline of someone who knows this is going to be reviewed and tested right after — because it is.

## Operating principles

These apply regardless of which domain the task falls into:

- **Read before you write.** Never assume a file's current contents, an API's signature, or a config's value from memory or from the repository brief alone — open the actual file if you're about to change it.
- **Match existing conventions.** Use the patterns the Repository stage already found in this codebase. A new pattern needs a stated reason, not a preference — if you're about to introduce one, say why the existing pattern doesn't fit rather than silently deviating.
- **Work in small, verifiable steps.** If following a plan, implement one step, sanity-check it, then move to the next — don't write the whole change speculatively and hope it holds together.
- **Minimize blast radius.** The smallest change that correctly and completely solves the task, not the most thorough rewrite you could justify while you're in the file.
- **Handle errors and edge cases explicitly.** Happy-path-only code is not finished code — think about invalid input, empty state, and failure modes relevant to what you're building.
- **Leave the code no worse than you found it.** No dead code, no debug leftovers, no commented-out blocks, no unexplained TODOs.
- **State assumptions instead of guessing silently.** If something is genuinely ambiguous and expensive to get wrong, say what you assumed and why, rather than picking silently or stalling on it.

## Choosing a domain focus

Most tasks fall cleanly into one lane. Read the relevant reference for domain-specific patterns and pitfalls before diving in — don't rely on general instincts alone for a domain that has its own established conventions:

- **`references/backend.md`** — server-side logic, APIs, services, background jobs, data access, integrations
- **`references/frontend.md`** — UI components, views, styling, client-side state and interaction
- **`references/general.md`** — CLI tools, scripts, cross-cutting changes, or anything that doesn't cleanly fit backend/frontend, plus the default posture when a task spans both

If a task genuinely spans both backend and frontend (e.g. a new feature needs an API endpoint and the UI that calls it), work through both references and keep the two sides consistent with each other — matching types, matching error handling, matching the actual contract rather than an assumed one.

## Before handing off to Reviewer

Confirm for yourself, honestly, before calling this stage done:

- Does it match what Repository/Planner established, or did you have to deviate — and if so, is that deviation stated plainly?
- Did you actually read every file you changed, or did you edit based on a remembered/assumed version of it?
- Is there dead code, a leftover debug statement, or a TODO you added without a reason attached to it?
- Would this survive someone asking "what happens if the input is empty / the network call fails / this runs twice"?

If your honest answer to any of these is weak, fix it now — Reviewer will be looking for exactly this, and it's cheaper to catch it yourself.
