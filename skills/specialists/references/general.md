# General-purpose focus

CLI tools, scripts, cross-cutting changes, or anything spanning multiple layers.

## When this is the right lane

- The task is a script, CLI command, or tool rather than an app feature
- The change is cross-cutting (build config, tooling, dependency updates, a lint rule)
- The task genuinely spans backend and frontend and needs both handled consistently — read `backend.md` and `frontend.md` too, and use this file for the coordination between them
- Nothing about the task maps cleanly to "backend" or "frontend"

## What to check before writing

- **The actual invocation surface.** For a CLI tool, check existing subcommands, flag naming conventions, and exit code conventions already used elsewhere in the project — a new command should feel like the others.
- **Cross-cutting consistency.** If a change spans layers (e.g. an API contract change plus the client that consumes it), make the two sides agree on the exact same shape — recheck the actual code on both sides rather than assuming they match because they were designed to.
- **Existing tooling conventions.** Build scripts, CI config, and lint rules usually encode decisions made for a reason — don't casually change one to make a single task easier without understanding why it's set that way.

## Common failure modes to avoid

- Writing a script that assumes a clean environment (no error handling for a missing file, a missing env var, a partially-run previous invocation).
- Inconsistent flag/argument naming compared to the rest of the CLI.
- Fixing a cross-cutting bug on only one side of a boundary (updated the API but not the client that calls it, or vice versa).

## Before moving on

If this is a script or CLI change: what happens if it's run twice, or interrupted halfway? If this is a cross-layer change: did you actually verify both sides against each other, not just against your own assumption of what the other side does?
