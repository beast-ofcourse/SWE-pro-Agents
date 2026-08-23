---
name: goal
description: "Set, show, pause, resume, or clear the active thread goal — arms the autonomous loop. Use when user says /goal, set goal, show goal, clear goal, pause or resume the loop, or wants to arm the continuation nudge."
license: MIT
compatibility: opencode
---

# Goal — Thread Goal for Autonomous Loop

Pack-shipped `/goal` slash command. No external plugin needed. It arms the `plugins/continuation.js` loop: `command.executed{ name:"goal" }` → `armedSessions` Map.

## When to use

- User types `/goal`, `/goal <objective>`, `/goal show|status|help`, `/goal clear|stop|off|reset|none|cancel`, `/goal pause`, `/goal resume`
- User says "set goal", "show goal", "clear goal", "pause the loop", "resume the loop"

## Subcommands

Subcommand is `arguments.trim().toLowerCase()` as in `plugins/continuation.js:167`.

| Input | Effect on loop | Gate |
|-------|---------------|------|
| `/goal` or `/goal <objective>` | Set/replace goal, **arm** | `armedSessions.set(sessionID)` |
| `/goal show` / `status` / `help` / `""` with help intent | Report + help. **MVP arms** (fires `command.executed{ arguments:"show" }` so gate arms). Ideal neutral — document limitation; future plugin can make `show` neutral. |
| `/goal pause` | **Disarm**, silent on idle | `delete` |
| `/goal resume` | **Re-arm** (with or without new objective) | `set` |
| `/goal clear` `stop` `off` `reset` `none` `cancel` | **Clear/disarm**, idempotent | `delete` |

All names case-insensitive. Bare `/goal` arms.

## Agent instructions

When this skill is invoked (skill `parts` delivered to agent):

1. Parse `arguments` as above. Do not read `plans/state.json` for this skill — gate is in plugin.
2. Reply in one line + help line:
   - Set: `Goal set: "<objective>" — loop armed. I'll continue on idle while ledger is running.`
   - Pause: `Goal paused — loop will not nudge on idle. Use /goal resume to continue.`
   - Resume: `Goal resumed: "<objective or previous>" — loop armed.`
   - Clear: `Goal cleared — loop disarmed. No further auto-continue.`
   - Show/status: recall last objective from conversation (best-effort); if none, `No active goal remembered — set one with /goal <objective>.` Then `Current ledger: ` + brief `summary(state)` if ledger exists (read `plans/state.json` only for display), else no ledger line. End with `Usage: /goal [<objective>] | /goal show | /goal pause|resume | /goal clear (aliases: stop,off,reset,none,cancel)`.
3. Never modify `plans/state.json` for goal — plugin owns `armedSessions`, ledger owns tasks.
4. Note fail-closed: restart loses arm — fresh `/goal` required. Headless `swe-pro-agents run` needs no `/goal`.

## Examples

- `/goal implement plans/tasks.md` → `Goal set: "implement plans/tasks.md" — loop armed.`
- `/goal show` → `Current goal: "implement plans/tasks.md" (armed). Usage: ...`
- `/goal pause` → `Goal paused — ...`
- `/goal clear` → `Goal cleared — ...`
- `/goal resume` → `Goal resumed — loop armed.`

## Notes

- Plugin checks in order: `agent==swe-pro` → `armed?` → `shouldResume(ledger)` → `session.prompt(nudge)`. Any `in_progress` blocks nudge. Skill does not bypass that.
- Collision: if OpenCode ships a built-in `goal` skill, pack’s `skills/goal` shadows its prompt but both fire same `command.executed` name — either arms gate. Documented.
