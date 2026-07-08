---
description: Kick off a new project or feature from scratch through Phase 0-5 (understand, research, requirements, architecture, planning)
agent: orchestrator
---

A new goal has been given: $ARGUMENTS

Run Phase 0 through Phase 5 of your core loop as defined in your system
prompt:

1. **Phase 0** — Parse intent, infer defaults, detect constraints, ask
   clarifying questions only if truly blocking. Write the opening sections
   of `docs/project-overview.md`.
2. **Phase 1** — Delegate to `researcher` for a full research pass.
   Produce `docs/research.md`.
3. **Phase 2** — Convert research into `docs/requirements.md` (numbered
   FR/NFR/UXR/SEC/PERF/SCALE/MAINT requirements).
4. **Phase 3** — Delegate to `planner` for `docs/architecture.md`.
5. **Phase 4** — Finalize all of `docs/project-overview.md`.
6. **Phase 5** — Delegate to `planner` for the initial `docs/tasks.md`
   backlog, broken into concrete, traceable, well-scoped tasks.

Do not begin Phase 6 (execution) yet — stop after Phase 5 and present a
summary of the goal statement, key architecture decisions, and the
resulting task count by phase, so the user can review before you start
building.
