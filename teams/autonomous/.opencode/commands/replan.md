---
description: Restructure the living documents (tasks.md, architecture.md, project-overview.md) after a scope change or newly discovered complexity
agent: orchestrator
---

The following change or discovery needs to be reflected in the project's
living documents: $ARGUMENTS

1. Determine what's actually affected: does this change the goal/scope
   (`project-overview.md`), the requirements (`requirements.md`), the
   architecture (`architecture.md`), the task backlog (`tasks.md`), or
   several of these.
2. Delegate to `planner` to make the necessary updates, following each
   document's own living-document rules:
   - `project-overview.md`: edit the body, append a dated entry to its
     Revision Log explaining what changed and why.
   - `architecture.md`: edit the body, append a dated entry to its
     Revision Log.
   - `tasks.md`: never delete or renumber existing tasks — mark superseded
     tasks with an updated status and a note, create new TASK-IDs for new
     work, use "Discovered from" to link related tasks.
3. If the change affects work already marked `done`, flag this explicitly
   — don't silently leave stale "done" status on something the new
   information contradicts. Either reopen the task with a clear note, or
   create a new follow-up task if the original work is still valid but
   incomplete relative to the new information.
4. Report back a summary: what changed in each document, and whether this
   affects the current Phase 10 readiness assessment.
