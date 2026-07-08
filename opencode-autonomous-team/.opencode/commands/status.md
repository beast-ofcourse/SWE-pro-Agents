---
description: Report current project status from the living documents — no new work performed
agent: orchestrator
subtask: false
---

Read the current state of `docs/project-overview.md`, `docs/tasks.md`, and
`docs/architecture.md` (if they exist) and report, without making any
changes:

1. **Goal statement** (from project-overview.md) — one line.
2. **Task summary**: total tasks, and counts by status (pending,
   in-progress, blocked, needs-review, done), broken down by phase.
3. **Blocked tasks**: list each one with its blocking reason and whether an
   unblocking task exists.
4. **Recently discovered tasks**: any tasks with a "Discovered from" field
   added since the last status check, if you can tell from context.
5. **Architecture drift**: any notes in architecture.md's revision log that
   suggest the implementation has moved away from the original plan.
6. **Phase 10 readiness**: your honest current assessment — could a real
   user achieve the stated goal with what's on disk right now? Yes, no, or
   partially, with specifics either way.

Keep this concise — a status report, not a re-litigation of every
decision.
