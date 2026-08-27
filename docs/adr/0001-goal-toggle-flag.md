# Goal system toggled by config flag, not by plugin removal

We added a yes/no toggle for the `/goal` + continuation system (plan
`plans/goal-toggle.md`). Decision: the system is **flag-gated** — the plugin stays
installed but self-disables via `features.goal` in `swe-pro-agents.config.json`,
rather than being omitted from install when disabled.

**Considered options:**
- *(a) Omit the plugin when disabled* — cleanest separation (no inert code loads), but
  re-enabling requires a reinstall and loses the one-file source of truth.
- *(b) Flag-gated (chosen)* — the plugin reads the flag on every `session.idle` (and on
  `command.executed`), so the toggle is live without an OpenCode restart; disabling
  leaves the plugin loaded but inert.

**Consequences:** the flag is the single switch for the autonomous path; the CLI `run`
path is intentionally unaffected (it was never `/goal`-gated). Because the flag is
re-read per idle, there is no "restart to apply" step — a deliberate deviation from the
original plan, which cached the flag at plugin load.
