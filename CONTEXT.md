# Autonomous Loop & Goal Gate

The domain of the pack's self-driving plan execution: a `/goal` command that arms a
session, a plugin that nudges an idle `swe-pro` session to continue a `plans/tasks.md`
loop, and the ledger that tracks progress. Terms below are specific to this pack.

## Language

**Goal**:
An explicit `/goal` command issued in a session; the activation gate for the
autonomous loop. The loop never runs on idle alone — it requires an active goal.
_Avoid_: objective, task, plan

**Armed session**:
A session in which a `/goal` has fired and has not yet been disarmed. Arm state is
in-memory and per-session; an OpenCode restart or plugin reload resets every session
to unarmed (fail-closed — a fresh `/goal` is then required).
_Avoid_: active goal, enabled session

**Disarm**:
A `/goal clear` (aliases `stop`, `off`, `reset`, `none`, `cancel`) or `/goal pause`
that removes the session from the armed set, so the plugin will no longer nudge it.
_Avoid_: deactivate, stop

**Neutral**:
A `/goal show`, `/goal status`, or `/goal help` invocation that reports the current
goal/ledger state without changing the arm state. These are read-only and never arm
or disarm. (Historically `show` armed the loop — that was a bug, fixed when the
neutral set was defined.)
_Avoid_: view, inspect

**Nudge**:
The plugin's `session.idle` prompt that resumes `swe-pro` to continue the loop — fired
only when the session is armed AND the ledger says the loop should continue (status
`running`, no task `in_progress`, at least one `pending`).
_Avoid_: resume, trigger

**Ledger**:
`plans/state.json` — the loop's single source of truth: schema version, ledger status,
per-task statuses, and attempt/iteration budgets. Atomic writes (`.tmp` then rename).
_Avoid_: state, database

**Feature flag**:
`swe-pro-agents.config.json → features.goal` — a project-root config that gates the
plugin/autonomous path only. The CLI `run` path is command-activated and unaffected.
_Avoid_: setting, toggle

**Fail-closed**:
The design posture that, on any uncertainty (no goal command seen, plugin restarted,
config unreadable), the loop does not activate. Safety overrides convenience.
_Avoid_: safe-by-default (that implies the opposite — fail-closed means it stays OFF)
