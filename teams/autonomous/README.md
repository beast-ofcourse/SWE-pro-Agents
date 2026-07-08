# Autonomous Agent Team for OpenCode

A 1 primary + 9 subagent engineering team for [OpenCode](https://opencode.ai),
implementing a full goal → research → requirements → architecture →
planning → execution → verification → self-critique → polish → goal-
validation loop, with two continuously-updated living documents
(`docs/project-overview.md` and `docs/tasks.md`) instead of one-shot plans.

```
User
  │
  ▼
Autonomous Orchestrator (primary agent, mode: primary)
  │
  ├── researcher     — competitor/OSS/library/pattern research
  ├── planner        — requirements, architecture, living task backlog
  ├── frontend       — UI implementation
  ├── backend        — API/DB/auth implementation
  ├── tester         — writes and actually runs tests, reports real results
  ├── performance    — measures and optimizes, before/after numbers only
  ├── security       — evidenced findings, never a generic checklist
  ├── docs-writer    — README/API docs/changelog/deployment guide
  └── reviewer       — independent, read-only production-readiness gate
```

## What's actually in this zip

```
.
├── opencode.json                    # root config — models, permissions, default agent
├── AGENTS.md                        # project-wide conventions loaded for every agent
├── README.md                        # this file
├── CHANGELOG.md                     # starter changelog, maintained by docs-writer
├── .gitignore
├── .opencode/
│   ├── agents/
│   │   ├── orchestrator.md          # primary agent — the 10-phase loop lives here
│   │   ├── researcher.md
│   │   ├── planner.md
│   │   ├── frontend.md
│   │   ├── backend.md
│   │   ├── tester.md
│   │   ├── performance.md
│   │   ├── security.md
│   │   ├── docs-writer.md
│   │   └── reviewer.md
│   └── commands/
│       ├── start-project.md         # /start-project — Phase 0-5
│       ├── build.md                 # /build — Phase 6-10, the execution loop
│       ├── status.md                # /status — read-only living-doc report
│       └── replan.md                # /replan — restructure docs after scope change
└── docs/
    └── templates/
        ├── project-overview.template.md
        ├── research.template.md
        ├── requirements.template.md
        ├── architecture.template.md
        └── tasks.template.md
```

The `docs/*.md` **files themselves** (not the templates) get created by the
agents the first time you run `/start-project` — they don't ship pre-filled
because they're supposed to reflect *your* actual project, not a generic
example.

## Requirements

- [OpenCode](https://opencode.ai) installed (`curl -fsSL https://opencode.ai/install | bash`,
  or see their docs for your platform).
- At least one model provider configured (Anthropic, OpenAI, or any
  provider OpenCode supports) — run `opencode auth login` if you haven't
  already, or set the relevant API key env var.
- This scaffold defaults to `anthropic/claude-sonnet-4-5` as the main model
  and `anthropic/claude-haiku-4-5` as the small/cheap model in
  `opencode.json`. **Change these to whatever provider/model you actually
  have access to** — see [Changing the model(s)](#changing-the-models)
  below.

## Installation

1. Unzip this into an **empty folder**, or the root of an existing project
   you want this team to work on.
   ```bash
   unzip opencode-autonomous-team.zip -d my-project
   cd my-project
   ```
2. If you're dropping this into an *existing* codebase, that's fully
   supported — the orchestrator is instructed to detect and respect
   existing conventions rather than assuming a greenfield build. Just make
   sure `opencode.json` and `AGENTS.md` at the repo root don't collide with
   ones you already have (merge them by hand if you already have your own
   `opencode.json` — OpenCode merges config files, but two files with the
   same name can't both exist at the same path, so combine them).
3. Start OpenCode in this directory:
   ```bash
   opencode
   ```
4. Confirm the agent team loaded:
   ```
   /agents
   ```
   You should see `orchestrator` as a primary agent and the nine
   specialists listed as subagents.

## First run

Give it a goal:

```
/start-project Build a habit-tracking web app. Users can create habits,
check them off daily, and see a streak. Should work on mobile browsers.
No budget for paid infra right now — free tier only.
```

This runs Phase 0 through Phase 5: it will infer reasonable defaults, ask
you at most a couple of clarifying questions only if something is truly
ambiguous, delegate real research to `researcher`, turn that into
requirements, design the architecture, and produce an initial `docs/tasks.md`
backlog — then **stop and show you a summary** before writing any
application code, so you can sanity-check the plan.

If it looks right:

```
/build
```

This runs the full autonomous execution loop (Phase 6–10): implement →
test → lint → fix → review → optimize → document → commit, task by task,
until the orchestrator can honestly say a real user could pick up the
result and achieve the original goal.

Check in any time without triggering new work:

```
/status
```

If you change your mind about scope mid-project, or the team discovers
something that changes the plan:

```
/replan We actually need multi-user support, not just single-user local
storage.
```

You can also just talk to the orchestrator in plain language instead of
using the slash commands — the commands are shortcuts, not the only way in.
`@mention` any individual specialist directly too (e.g. `@security review
the auth flow`) if you want to talk to one specifically.

## Why it's structured this way

- **One primary agent, nine subagents** — matches how OpenCode's Task tool
  and `@mention` routing actually work: primary agents hold the
  conversation and delegate; subagents run in their own session/context
  window and report back.
- **Every subagent has `task: deny`** — no subagent can spawn another
  subagent. Only the orchestrator can dispatch work, and only to the nine
  agents explicitly allow-listed in its own `permission.task` config. This
  is a deliberate guard against uncontrolled recursive delegation (a known
  sharp edge in agentic frameworks generally — chains that keep spawning
  child tasks with no depth limit can burn enormous amounts of time and
  tokens for no additional work done).
- **Destructive commands are denied or gated at the permission layer**, not
  just discouraged in prose — `rm -rf`, force-pushes, `sudo`, and database
  drops are blocked or require explicit approval across every agent.
- **Living documents, not one-shot output.** `docs/project-overview.md` and
  `docs/tasks.md` are designed to be edited continuously: tasks move
  through pending → in-progress → blocked → needs-review → done, new tasks
  get created the moment unexpected complexity surfaces, and nothing gets
  silently renumbered or deleted — see each template's own comments for
  the exact rules each agent follows.
- **Evidence over vibes.** `tester`, `performance`, and `security` are all
  explicitly instructed to report only what they actually ran/measured/
  found — never a plausible-sounding but fabricated result. `reviewer` is
  read-only by design so its judgment stays independent of whoever wrote
  the code.

## Changing the model(s)

Edit the top of `opencode.json`:

```jsonc
{
  "model": "anthropic/claude-sonnet-4-5",      // main model
  "small_model": "anthropic/claude-haiku-4-5"  // cheap model for light tasks
}
```

Subagents inherit the model of whichever primary agent invoked them unless
you add a `model` field to that specific subagent's own frontmatter (see
`.opencode/agents/researcher.md` etc.) — for example, to run `researcher`
on a cheaper/faster model than your main model, add a line like
`model: anthropic/claude-haiku-4-5` to its frontmatter block. Run
`opencode models` to see what's available to you.

## Adjusting permissions

Every agent's `permission` block in its own file controls exactly what it
can do without asking, what needs approval, and what's outright denied.
If a workflow keeps prompting you for approval on something you're
comfortable auto-allowing (e.g. you always want `git push` to just work),
edit the relevant agent's `permission.bash` entries — see
[OpenCode's permissions docs](https://opencode.ai/docs/permissions/) for
the full syntax (wildcards, glob patterns, last-match-wins ordering).

## Extending the team

To add another specialist (e.g. a dedicated `devops` agent for
infrastructure-as-code work):

1. Create `.opencode/agents/devops.md` following the same pattern as the
   existing subagents (frontmatter: `description`, `mode: subagent`,
   scoped `permission` block including `task: {"*": "deny"}`, then a
   system prompt body).
2. Add `"devops": "allow"` to the orchestrator's `permission.task` block in
   `.opencode/agents/orchestrator.md`.
3. Add a row for it to the specialist table in the orchestrator's own
   prompt so it knows when to reach for it.
4. Restart OpenCode (or start a new session) to pick up the new agent.

## Troubleshooting

- **A subagent doesn't seem to get invoked automatically** — you can always
  force it directly: `@researcher find prior art for X`. Description-based
  auto-routing depends on your OpenCode version behaving as documented;
  manual `@mention` always works as a fallback.
- **Config doesn't seem to load** — run `opencode debug config` to see the
  fully merged, resolved configuration and confirm there's no path
  collision with a config you already had.
- **Permission prompts everywhere** — that's the safe default. Loosen
  specific `bash` patterns in the relevant agent file once you trust the
  workflow; don't blanket-allow `bash: "*": allow"` without thinking about
  it, especially not for `backend` (which can reach your database) or
  anything that can reach `git push`.
