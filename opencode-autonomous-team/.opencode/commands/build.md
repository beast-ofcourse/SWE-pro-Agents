---
description: Run the autonomous execution loop (implement, verify, critique, polish) until the goal is validated as achievable by a real user
agent: orchestrator
---

Begin or resume Phase 6 (Autonomous Execution) using the current
`docs/tasks.md` backlog. $ARGUMENTS

For every pending/in-progress task, respecting dependencies:

1. Read the task's full spec in `docs/tasks.md`.
2. Delegate implementation to the correct specialist (`frontend`,
   `backend`).
3. Delegate test writing/execution to `tester`.
4. Run lint/typecheck/format; fix any failures by looping back to the
   implementing specialist.
5. Delegate self-review to `reviewer`; if verdict is CHANGES REQUESTED,
   route findings back and re-loop.
6. Delegate optimization to `performance` if the task is performance-
   sensitive per its requirement refs.
7. Delegate a security pass to `security` if the task touches auth, data
   handling, or user input.
8. Delegate documentation updates to `docs-writer`.
9. Commit with a conventional-commit message referencing the TASK-ID.
10. Update the task's status in `docs/tasks.md` to `done` with evidence
    attached, or `blocked` with a reason and a new unblocking task created.

After all in-scope tasks reach `done` or explicit user-approved deferral,
run Phase 7 (continuous verification already folded into the loop above),
Phase 8 (self-critique via `reviewer` — return to execution if it surfaces
real gaps), Phase 9 (final polish: dead code, unused deps, bundle
optimization, README/CHANGELOG/deployment guide via `docs-writer`), and
Phase 10 (goal validation — actually verify a real user could achieve the
stated goal right now).

Report back with a clear status: what's built, what passed verification,
and whether Phase 10 says **production ready** or **not yet, because X**.
