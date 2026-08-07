# SWE Pro Agents

<!-- markdownlint-disable MD033 -->

<div align="center">

<img src="assets/banner.png" alt="SWE Pro Agents — a full engineering team in your terminal" width="100%" />

[![npm version](https://img.shields.io/npm/v/swe-pro-agents?color=blue&style=flat-square)](https://www.npmjs.com/package/swe-pro-agents)
[![npm downloads](https://img.shields.io/npm/dt/swe-pro-agents?style=flat-square)](https://www.npmjs.com/package/swe-pro-agents)
[![CI](https://img.shields.io/github/actions/workflow/status/beast-ofcourse/SWE-pro-Agents/ci.yml?style=flat-square)](https://github.com/beast-ofcourse/SWE-pro-Agents/actions)
[![license](https://img.shields.io/github/license/beast-ofcourse/SWE-pro-Agents?style=flat-square)](LICENSE)

**26 OpenCode agent profiles (22 subagents + 4 primary) + 6 skills — a full engineering team in your terminal.**

</div>

---

## Table of Contents

- [Why This Exists](#why-this-exists)
- [What You Get](#what-you-get)
- [How It Works](#how-it-works)
- [Verified](#verified)
- [Requirements](#requirements)
- [Install](#install)
- [Quick Start](#quick-start)
- [CLI Reference](#cli-reference)
- [Agents](#agents)
  - [🛠️ SWE Agents — Engineering Core](#swe-agents)
  - [🔬 Research Agents](#research-agents)
  - [🏗️ Architecture Agents](#architecture-agents)
- [Skills](#skills)
  - [Agents vs. skills](#agents-vs-skills)
- [Workflows](#workflows)
- [Updating](#updating)
- [Uninstalling](#uninstalling)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

---

## Why This Exists

Most AI coding assistants start blank — no domain expertise, no engineering discipline, just a raw model and your prompt. Every session is ground zero.

SWE Pro Agents fixes that. Each agent is a **loaded expert**: a complete system prompt with tool permissions, behavioral rules, and error-handling conventions baked in. You don't ask a model to "review this PR"; you invoke `swe-reviewer`, an agent that already knows how to assess blast radius, flag security issues, and enforce your standards.

---

## What You Get

- **26 specialized agent profiles** — 22 subagents plus 4 primary agents (`swe-pro`, `architect`, `swe-reviewer`, `pr-reviewer`), each with a focused role, a curated prompt, and explicit tool permissions (read-only roles get deny-lists, implementers get scoped allow-lists).
- **6 on-demand skills** — token compression, skill authoring, adaptive tutoring, README generation, SVG heroes, and an anti-AI-slop editor; loadable from any agent via OpenCode's skill tool.
- **A manifest-based installer** — records what it installs, prunes stale agents/skills on update, never guesses ownership.
- **A safe uninstaller** — removes only files the pack owns; your own skills and merged config are untouched.
- **A status/setup CLI** — checks install state, shows the config snippet, writes it with a backup, checks for updates (offline-safe).
- **Zero runtime dependencies** — Node ≥ 18, plain stdlib.

---

## How It Works

Three layers, each with a different job:

1. **`agents/` — the team.** One Markdown file per agent: a frontmatter block with tool permissions (read-only roles get deny-lists, implementers get scoped allow-lists) plus a curated system prompt. OpenCode loads these directly.
2. **`AGENTS.md` — the shared foundation.** Agent files stay short because each assumes one shared rulebook — the Engineering Operating System (Core priorities, Engineering rules, Completion checklist, Reporting format) — is already in context. Cross-cutting rules live here once, not repeated per agent.
3. **`skills/` — utilities, not team members.** Self-contained `SKILL.md` units any agent can load on demand. They don't depend on `AGENTS.md`, so they work in any project.

The installer (`scripts/install.js`) copies agents, skills, and `AGENTS.md` into your OpenCode config and records everything in a manifest at `~/.config/swe-pro-agents/manifest.json`. On update it prunes files the pack no longer ships; on uninstall it removes only what the pack owns. Agents chain through the [workflows](#workflows) below — each handoff is a written artifact (`plans/`, `plans/validation.md`, `PR-review.md`, `review-report.md`), so no context is lost between steps.

---

## Verified

Quality is **machine-checked, not claimed**. A zero-dependency validator (`scripts/validate.js`, run as `npm run validate`) lints every agent and skill and **fails the build on any violation**:

- every agent parses — valid frontmatter, single-line description, valid mode, permission refs limited to known agents (pack subagents, OpenCode built-ins, or wildcards);
- the primary set is exact — `swe-pro`, `architect`, `swe-reviewer`, `pr-reviewer` — with no duplicates;
- every skill passes spec validation — `SKILL.md` present, name matches its directory, trigger-rich description, `MIT` license, `opencode` compatibility;
- agent and skill counts are integrity-checked against `package.json` and this README.

All of it is enforced in CI (`.github/workflows/ci.yml`) on Linux + Windows × Node 18/20/22: a violation goes red until the pack complies, and the validator is self-tested (`test/validate.test.js`) so the check can't silently rot.

---

## Requirements

| Requirement | Version / notes |
| ----------- | --------------- |
| Node.js | ≥ 18 (stdlib only — the package itself has zero dependencies) |
| OpenCode | A recent release; agents are defined as standard OpenCode agent files |
| npm | Any current version (`npm i -g` is the supported install path) |

Windows is supported end to end: paths derive from your home directory, and CI runs the full suite on `windows-latest`.

---

## Install

```bash
npm install -g swe-pro-agents
```

The postinstall hook copies:

- all agent profiles to `~/.config/opencode/agents/swe-pro-agents/`,
- all 6 skills to `~/.config/opencode/skills/`,
- this pack's `AGENTS.md` to `~/.config/opencode/agents/swe-pro-agents/AGENTS.md`.

That last file matters: every agent in `agents/` is intentionally short because it assumes `AGENTS.md`'s Engineering Operating System (Core priorities, Engineering rules, Completion checklist, Reporting format) is already loaded into context. If you don't already have a global `~/.config/opencode/AGENTS.md`, copy the installed one into place:

```bash
cp ~/.config/opencode/agents/swe-pro-agents/AGENTS.md ~/.config/opencode/AGENTS.md
```

If you already have one, merge in whatever sections you want — the installer never overwrites a global `AGENTS.md` automatically, on purpose. `swe-pro-agents status` tells you which state you're in.

> **Windows users:** paths are the same under `%USERPROFILE%` (`C:\Users\you\.config\opencode\...`), and `cp` becomes `Copy-Item`. The installer itself is cross-platform — it derives everything from your home directory, and CI runs the full test suite on Windows.

Then register the agents with OpenCode by adding to your `opencode.json`:

```json
{
  "agents": [{ "path": "~/.config/opencode/agents/swe-pro-agents" }]
}
```

Or let the CLI do it — it backs up your config first, then adds the entry:

```bash
swe-pro-agents setup --apply
```

**That's it.** Restart OpenCode and your entire agent team is ready. The manifest at `~/.config/swe-pro-agents/manifest.json` records exactly what was installed; on every install or update it prunes previously installed agents and skills the pack no longer ships — so upgrading never leaves stale files — and uninstall removes only what the pack owns, never your own skills.

---

## Quick Start

```bash
npm install -g swe-pro-agents            # one time
swe-pro-agents setup --apply             # adds the agents path to opencode.json (backs up first)
swe-pro-agents status                    # verify: agents installed, config referenced, AGENTS.md in place
```

If `status` warns that no global `AGENTS.md` is loaded, copy the pack's shared foundation into place (the agents are lean by design and assume it):

```bash
cp ~/.config/opencode/agents/swe-pro-agents/AGENTS.md ~/.config/opencode/AGENTS.md
```

Restart OpenCode, then use any agent — you're set:

```text
@architect     Build me a spec for a SaaS billing app
@swe-pro       Implement the next task in plans/tasks.md
@pr-reviewer   Review PR #12
@swe-reviewer  Review the last commit for security issues
```

The invoked agent loads a focused system prompt with scoped tool permissions — not a blank-slate session.

---

## CLI Reference

`bin/swe-pro-agents.js` — the only shipped executable:

| Command               | What it does                                                                 |
| --------------------- | ---------------------------------------------------------------------------- |
| `setup`               | Prints the `opencode.json` snippet and checks your global `AGENTS.md` state   |
| `setup --apply`       | Writes the `opencode.json` entry (backs up the existing config to `.bak` first) |
| `status`              | Shows installation state + npm update check (5s timeout, offline-safe)       |
| `version`             | Prints the package version                                                    |
| `help`                | Shows usage                                                                   |

---

## Agents

The team is organized into three squads. Each agent has a focused role, explicit tool permissions, and a curated system prompt optimized for that specific job.

<a name="swe-agents"></a>

### 🛠️ SWE Agents — Engineering Core

| Agent                | Role                                                                            |
| -------------------- | ------------------------------------------------------------------------------- |
| `swe-api`            | API contract design + implementation, request/response validation, versioning   |
| `swe-backend`        | Server-side logic, services, background jobs, integrations                      |
| `swe-database`       | Data modeling, schema design, migrations, query optimization, indexing          |
| `swe-debugger`       | Root-cause analysis through reproduction, then minimal correct fix              |
| `swe-desktop`        | Desktop apps — windowing, OS APIs, native packaging                             |
| `swe-devops`         | CI/CD pipelines, containers, infrastructure-as-code                             |
| `swe-documentation`  | READMEs, docstrings, API references, developer guides                           |
| `swe-frontend`       | Components, views, styling, state, animation, client interaction                |
| `swe-fullstack`      | End-to-end features keeping frontend and backend in sync                        |
| `swe-git`            | Branch management, commit hygiene, rebase, PR preparation                       |
| `swe-implementation` | General-purpose implementation (incl. CLI tools) for well-defined tasks         |
| `swe-mobile`         | Mobile screens, navigation, platform APIs, on-device perf                       |
| `swe-performance`    | Profiling, memory optimization, latency reduction — measured, not guessed       |
| `swe-pro`            | Senior engineer — planning, architecture decisions, code review, mentoring      |
| `swe-refactor`       | Restructuring code for clarity and maintainability without behavior change      |
| `swe-release`        | Versioning, changelogs, licensing, contribution readiness, publishing           |
| `swe-repository`     | Mapping unfamiliar codebases — structure, conventions, build commands           |
| `swe-reviewer`       | Read-only code review — correctness, risk, standards enforcement                |
| `pr-reviewer`        | PR review (CodeRabbit-style) — Critical/Major/Minor/Optional findings with fixes, written to `PR-review.md` |
| `swe-security`       | Vulnerability auditing, threat modeling, unsafe pattern detection               |

<a name="research-agents"></a>

### 🔬 Research Agents

| Agent            | Role                                          |
| ---------------- | --------------------------------------------- |
| `web-researcher` | Real-time web research for current information |

<a name="architecture-agents"></a>

### 🏗️ Architecture Agents

| Agent                      | Role                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| `architect`                | Spec-driven planning — interviews the user (or takes a "yolo" mandate), writes `plans/` (overview, tasks, user-flow) |
| `arch-design`              | System and feature architecture, RFC/ADR authoring                    |
| `arch-distributed-systems` | Consistency, partitioning, consensus, failure modes                   |
| `arch-migration`           | Incremental migration planning with rollback strategies               |
| `arch-validator`           | Attacks the plans before the build — Critical/Major/Minor spec fixes |

Four of the 26 profiles are **primary** agents (selectable as your main agent): `swe-pro`, `architect`, `swe-reviewer`, and `pr-reviewer`. The rest are subagents, invoked from a primary agent or by name.

---

## Skills

Beyond agents, the pack ships **6 skills** — a token-compression mode, a skill-authoring suite, an adaptive tutoring loop, a professional README generator, an SVG hero generator, and an anti-AI-slop writing editor. Each is a self-contained `SKILL.md` loaded on demand via OpenCode's `skill` tool:

| Skill               | Purpose                                                    |
| ------------------- | ---------------------------------------------------------- |
| `caveman`           | Ultra-compressed mode, cuts output tokens ~65%             |
| `skill-creator`     | Design, write, and improve skills — craft principles + draft/test/iterate workflow |
| `teach-me`          | Adaptive tutor — explain, quiz, exercise, track mastery over time |
| `readme-generator`  | Professional READMEs — create, audit, upgrade from repo evidence |
| `svg-hero-generator`| Repo-aware SVG hero banners — 3–4 concepts, then final SVG |
| `humanizer-pro`     | Sharp human editor — edit drafts to read human, or detect AI-slop patterns with quoted evidence |

Skills auto-install to `~/.config/opencode/skills/` and are picked up automatically — no config needed.

<a name="agents-vs-skills"></a>

### Agents vs. skills

Agents are the team; skills are utilities. Invoke an agent directly (`@swe-frontend`, `@swe-backend`, …) when you know exactly which specialist you want. Agents are lean by design: they assume this pack's `AGENTS.md` is already loaded into context (OpenCode does this automatically) and only state what's specific to their domain — everything else (the Engineering Operating System: Core priorities, Engineering rules, Completion checklist, Reporting format) lives in `AGENTS.md` once, not repeated per agent. Their behavior depends on `AGENTS.md` being installed — see [Install](#install) if `swe-pro-agents status` reports it as missing.

The six skills are standalone utilities any agent can load on demand — `caveman` for compressed replies, `skill-creator` for authoring skills with rigor, `teach-me` for adaptive tutoring with persistent progress tracking, `readme-generator` and `svg-hero-generator` for repo-aware document artifacts, and `humanizer-pro` for prose that reads human. They are deliberately self-contained rather than `AGENTS.md`-dependent, because a skill can be invoked by any agent in any project — including ones that don't have this pack's `AGENTS.md` installed at all.

Not sure which to reach for? A single, well-scoped implementation task with a clear owner → an agent. A communication-mode or document-artifact need → the matching skill. Don't run both for the same task — that's redundant effort, not extra rigor.

---

## Workflows

These agents are designed to **chain together**. Here are real workflows:

### Full Project Lifecycle

```text
architect → swe-pro → pr-reviewer → swe-pro
```

Spec it (Architect interviews you or takes a `yolo` mandate, writes `plans/`; `arch-validator` stress-tests the plan until it's "ready to build"), build it (SWE Pro executes `plans/tasks.md` task by task in plan order, independent tasks in parallel), review it (PR Reviewer flags everything Critical / Major / Minor / Optional in `PR-review.md`), fix it (SWE Pro again, in the order the review prescribes). Repeat the last two steps until green — SWE Pro's finishing ceremony then offers to merge locally, open a PR, or keep the branch.

### Feature Delivery

```text
swe-pro → swe-implementation → swe-reviewer
```

Plan and implement, write tests, get reviewed. No context lost between steps.

### Bug Investigation

```text
swe-debugger → swe-security → swe-refactor
```

Find the root cause, check for similar vulnerabilities, clean up the code.

### Architecture Change

```text
architect → arch-migration → swe-database → swe-fullstack
```

Design the new architecture, plan the migration, update the schema, wire the full stack.

### Spec-Driven Build

```text
architect → swe-pro
```

Architect interviews you (or accepts a `yolo` mandate) until the spec is complete, then writes `plans/project-overview.md`, `plans/tasks.md`, and `plans/user-flow.md`. SWE Pro executes `plans/tasks.md` task by task in plan order — dispatching each task to a fresh subagent (independent tasks in the same phase run in parallel), reviewing each result twice (spec compliance, then code quality), and checking in with you after every phase. When done, a finishing ceremony offers: merge locally, open a PR, or keep the branch.

### PR Review

```text
pr-reviewer → swe-pro
```

Switch to PR Reviewer and name one or more PRs. It reviews each end to end — bugs, errors, conflicts, contract mismatches, security, improvements — categorized Critical / Major / Minor / Optional, every finding with a concrete fix, all written to `PR-review.md`. Switch to SWE Pro to fix in the order the review prescribes — Criticals, then Majors, then Minors; Optionals at your discretion.

### Production Incident

```text
swe-debugger → swe-performance → swe-devops
```

Diagnose the issue, profile the bottleneck, deploy the fix.

---

## Updating

```bash
npm update -g swe-pro-agents
```

The installer prunes agents and skills from older versions automatically (via the manifest), so nothing stale lingers in your config after an update. `swe-pro-agents status` shows what changed and warns when a newer version is available.

---

## Uninstalling

```bash
npm uninstall -g swe-pro-agents
```

The preuninstall hook removes everything this pack installed: the agent files, the pack's skills (`caveman`, `skill-creator`, `teach-me`, `readme-generator`, `svg-hero-generator`, `humanizer-pro`), and its manifest. Your own skills in `~/.config/opencode/skills/` are never touched.

Two things remain, by design — they're your content:

- The `opencode.json` entry referencing the agents path — delete it manually
- Any AGENTS.md sections you merged into your global config — edit manually

---

## Development

Plain Node.js (≥ 18), zero dependencies. There is no build step — the tests are the entry point:

```bash
# Run the full suite: 6 installer lifecycle tests + 11 validator self-tests
npm test

# Validate the pack (agents + skills, strict — exits 1 on any violation)
npm run validate

# Equivalents, without npm
node test/installer.test.js
node test/validate.test.js
node scripts/validate.js
```

The tests simulate install/update/uninstall against a **throwaway `HOME`/`USERPROFILE` directory**, so your real `~/.config/opencode` is never touched. Note that a plain `npm install` in this repo triggers the `postinstall` hook — run tests directly (as CI does) if you don't want the installer to run against your real config.

CI (`.github/workflows/ci.yml`) runs syntax checks (`node --check`), strict pack validation, and the full test suite on **Linux + Windows × Node 18/20/22**.

```text
SWE-pro-Agents/
├── agents/       26 agent profiles (4 primary, 22 subagents)
├── skills/       6 skills: caveman, skill-creator, teach-me, readme-generator, svg-hero-generator, humanizer-pro
├── scripts/      install.js (postinstall), uninstall.js (preuninstall), validate.js (pack validator)
├── bin/          swe-pro-agents CLI
├── test/         installer lifecycle tests + validator self-tests
├── .github/      CI workflow
├── AGENTS.md     shared foundation every agent assumes is loaded
└── package.json
```

---

## Contributing

Bug reports, feature requests, and PRs go through the [GitHub repository](https://github.com/beast-ofcourse/SWE-pro-Agents) — the [issues page](https://github.com/beast-ofcourse/SWE-pro-Agents/issues) is the place to start. Keep new agents lean: every agent file is short *because* it assumes the shared `AGENTS.md` foundation — put cross-cutting rules there, not in each prompt.

---

## License

MIT — use it, fork it, ship it. See [LICENSE](LICENSE).
