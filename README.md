# SWE Pro Agents

<!-- markdownlint-disable MD033 -->

<div align="center">

<img src="assets/banner.png" alt="SWE Pro Agents — a full engineering team in your terminal" width="100%" />

[![npm version](https://img.shields.io/npm/v/swe-pro-agents?color=blue&style=flat-square)](https://www.npmjs.com/package/swe-pro-agents)
[![npm downloads](https://img.shields.io/npm/dt/swe-pro-agents?style=flat-square)](https://www.npmjs.com/package/swe-pro-agents)
[![CI](https://img.shields.io/github/actions/workflow/status/beast-ofcourse/SWE-pro-Agents/ci.yml?style=flat-square)](https://github.com/beast-ofcourse/SWE-pro-Agents/actions)
[![license](https://img.shields.io/github/license/beast-ofcourse/SWE-pro-Agents?style=flat-square)](LICENSE)

**26 OpenCode agent profiles (22 subagents + 4 primary) + 9 skills — a full engineering team in your terminal.**

</div>

---

## News

Short highlights of what's changed recently. Full detail lives in [CHANGELOG.md](CHANGELOG.md).

**2.3.0**
- Pack grew from 6 to **9 skills**: `flowchart-html`, `high-quality-flowcharts`, and `opencode-skill-creator`.
- `AGENTS.md` restructured into the **Engineering Operating System (EOS)** — Core priorities, Engineering rules, Completion checklist, Reporting format, and more.

**2.2.0**
- New **`pr-reviewer`** primary agent — CodeRabbit-style end-to-end PR review (Critical/Major/Minor/Optional findings with fixes, written to `PR-review.md`). Pack is now 26 profiles.
- New skills: `humanizer-pro` (anti-AI-slop editor), `teach-me` (adaptive tutor), `skill-creator`.
- **Verification harness** — `npm run validate` statically checks every agent and skill and fails the build on any violation; wired into CI with 18 self-tests.
- SWE Pro hardened: finishing-work ceremony, parallel task dispatch, subagent-driven plan execution, hard gates, phase checkpoints.

---

## What It Is

Most AI coding assistants start blank — no domain expertise, no engineering discipline. SWE Pro Agents fixes that: each agent is a **loaded expert** with a curated system prompt, tool permissions, and behavioral rules baked in. You don't ask a model to "review this PR"; you invoke `swe-reviewer`, which already knows how to assess blast radius and enforce your standards.

- **26 agent profiles** — 22 subagents + 4 primary (`swe-pro`, `architect`, `swe-reviewer`, `pr-reviewer`), each with a focused role and scoped tool permissions.
- **9 on-demand skills** — token compression, skill authoring, tutoring, README/SVG/flowchart generation, an anti-AI-slop editor, and OpenCode skill creation.
- **Manifest-based installer & safe uninstaller** — records what it installs, prunes stale files on update, removes only what it owns.
- **Status/setup CLI** — checks install state, writes the config with a backup, checks for updates (offline-safe).
- **Zero runtime dependencies** — Node ≥ 18, plain stdlib.

## How It Works

Three layers:

1. **`agents/` — the team.** One Markdown file per agent: frontmatter tool permissions + a curated system prompt. OpenCode loads these directly.
2. **`AGENTS.md` — the shared foundation.** Agent files stay short because each assumes the Engineering Operating System (Core priorities, Engineering rules, Completion checklist, Reporting format) is already in context.
3. **`skills/` — utilities, not team members.** Self-contained `SKILL.md` units any agent can load on demand; they don't depend on `AGENTS.md`, so they work in any project.

The installer copies agents, skills, and `AGENTS.md` into your OpenCode config and records everything in a manifest. On update it prunes files the pack no longer ships; on uninstall it removes only what the pack owns. Agents chain through [workflows](#workflows) below — each handoff is a written artifact (`plans/`, `PR-review.md`, `review-report.md`), so no context is lost between steps.

## Verified

Quality is **machine-checked, not claimed**. A zero-dependency validator (`npm run validate`) lints every agent and skill and **fails the build on any violation** — valid frontmatter, exact primary set, skill spec compliance, and agent/skill counts integrity-checked against `package.json` and this README. Enforced in CI on Linux + Windows × Node 18/20/22, and self-tested so the check can't silently rot.

## Requirements

| Requirement | Version / notes |
| ----------- | --------------- |
| Node.js | ≥ 18 (stdlib only — zero dependencies) |
| OpenCode | A recent release |
| npm | Any current version |

Windows is supported end to end.

## Install

```bash
npm install -g swe-pro-agents
```

The postinstall hook copies agents to `~/.config/opencode/agents/swe-pro-agents/`, all 9 skills to `~/.config/opencode/skills/`, and this pack's `AGENTS.md` to the agents dir. That last file matters: every agent is intentionally short because it assumes the Engineering Operating System is loaded. If you have no global `~/.config/opencode/AGENTS.md`, copy the installed one into place:

```bash
cp ~/.config/opencode/agents/swe-pro-agents/AGENTS.md ~/.config/opencode/AGENTS.md
```

If you already have one, merge in what you want — the installer never overwrites a global `AGENTS.md` automatically. `swe-pro-agents status` tells you which state you're in.

Then register the agents with OpenCode:

```json
{
  "agents": [{ "path": "~/.config/opencode/agents/swe-pro-agents" }]
}
```

Or let the CLI do it (backs up your config first):

```bash
swe-pro-agents setup --apply
```

**That's it.** Restart OpenCode and your agent team is ready.

## Quick Start

```bash
npm install -g swe-pro-agents            # one time
swe-pro-agents setup --apply             # adds the agents path to opencode.json (backs up first)
swe-pro-agents status                    # verify: agents installed, config referenced, AGENTS.md in place
```

If `status` warns that no global `AGENTS.md` is loaded, copy the pack's shared foundation into place (the agents are lean by design and assume it). Restart OpenCode, then:

```text
@architect     Build me a spec for a SaaS billing app
@swe-pro       Implement the next task in plans/tasks.md
@pr-reviewer   Review PR #12
@swe-reviewer  Review the last commit for security issues
```

## CLI Reference

`bin/swe-pro-agents.js` — the only shipped executable:

| Command | What it does |
| --- | --- |
| `setup` | Prints the `opencode.json` snippet and checks your global `AGENTS.md` state |
| `setup --apply` | Writes the `opencode.json` entry (backs up the existing config to `.bak` first) |
| `status` | Shows installation state + npm update check (5s timeout, offline-safe) |
| `version` | Prints the package version |
| `help` | Shows usage |

## Agents

The team is organized into three squads. Each agent has a focused role, explicit tool permissions, and a curated system prompt.

### 🛠️ SWE Agents — Engineering Core

| Agent | Role |
| --- | --- |
| `swe-api` | API contract design + implementation, request/response validation, versioning |
| `swe-backend` | Server-side logic, services, background jobs, integrations |
| `swe-database` | Data modeling, schema design, migrations, query optimization, indexing |
| `swe-debugger` | Root-cause analysis through reproduction, then minimal correct fix |
| `swe-desktop` | Desktop apps — windowing, OS APIs, native packaging |
| `swe-devops` | CI/CD pipelines, containers, infrastructure-as-code |
| `swe-documentation` | READMEs, docstrings, API references, developer guides |
| `swe-frontend` | Components, views, styling, state, animation, client interaction — verified in a real browser |
| `swe-fullstack` | End-to-end features keeping frontend and backend in sync |
| `swe-git` | Branch management, commit hygiene, rebase, PR preparation |
| `swe-implementation` | General-purpose implementation (incl. CLI tools) for well-defined tasks |
| `swe-mobile` | Mobile screens, navigation, platform APIs, on-device perf |
| `swe-performance` | Profiling, memory optimization, latency reduction — measured, not guessed |
| `swe-pro` | Senior engineer — planning, architecture decisions, code review, mentoring |
| `swe-refactor` | Restructuring code for clarity and maintainability without behavior change |
| `swe-release` | Versioning, changelogs, licensing, contribution readiness, publishing |
| `swe-repository` | Mapping unfamiliar codebases — structure, conventions, build commands |
| `swe-reviewer` | Read-only code review — correctness, risk, standards enforcement |
| `pr-reviewer` | PR review (CodeRabbit-style) — Critical/Major/Minor/Optional findings with fixes, written to `PR-review.md` |
| `swe-security` | Vulnerability auditing, threat modeling, unsafe pattern detection |

<a name="research-agents"></a>

### 🔬 Research Agents

| Agent | Role |
| --- | --- |
| `web-researcher` | Real-time web research for current information |

<a name="architecture-agents"></a>

### 🏗️ Architecture Agents

| Agent | Role |
| --- | --- |
| `architect` | Spec-driven planning — interviews the user (or takes a "yolo" mandate), writes `plans/` (overview, tasks, user-flow) |
| `arch-design` | System and feature architecture, RFC/ADR authoring |
| `arch-distributed-systems` | Consistency, partitioning, consensus, failure modes |
| `arch-migration` | Incremental migration planning with rollback strategies |
| `arch-validator` | Attacks the plans before the build — Critical/Major/Minor spec fixes |

Four of the 26 profiles are **primary** agents (selectable as your main agent): `swe-pro`, `architect`, `swe-reviewer`, and `pr-reviewer`. The rest are subagents, invoked from a primary agent or by name.

## Skills

The pack ships **9 skills**, each a self-contained `SKILL.md` loaded on demand via OpenCode's `skill` tool:

| Skill | Purpose |
| --- | --- |
| `caveman` | Ultra-compressed mode, cuts output tokens ~65% |
| `skill-creator` | Design, write, and improve skills — craft principles + draft/test/iterate workflow |
| `teach-me` | Adaptive tutor — explain, quiz, exercise, track mastery over time |
| `readme-generator` | Professional READMEs — create, audit, upgrade from repo evidence |
| `svg-hero-generator` | Repo-aware SVG hero banners — 3–4 concepts, then final SVG |
| `humanizer-pro` | Sharp human editor — edit drafts to read human, or detect AI-slop patterns with quoted evidence |
| `flowchart-html` | Professional flowcharts as a single self-contained HTML file on a large SVG canvas |
| `high-quality-flowcharts` | Publication-grade PDF flowcharts/roadmaps — HTML+SVG source, PDF export, verification preview |
| `opencode-skill-creator` | Create, test, evaluate, and optimize OpenCode skills — evals, benchmarks, description tuning |

Skills auto-install to `~/.config/opencode/skills/` and are picked up automatically — no config needed.

### Agents vs. skills

Agents are the team; skills are utilities. Invoke an agent directly (`@swe-frontend`, `@swe-backend`, …) when you know exactly which specialist you want. Agents are lean by design: they assume this pack's `AGENTS.md` is already loaded into context and only state what's specific to their domain — everything else (the Engineering Operating System) lives in `AGENTS.md` once. Skills are standalone utilities any agent can load on demand, deliberately self-contained so they work in any project — including ones without this pack's `AGENTS.md`.

Not sure which to reach for? A single, well-scoped implementation task with a clear owner → an agent. A communication-mode or document-artifact need → the matching skill. Don't run both for the same task.

## Workflows

These agents are designed to **chain together**:

| Workflow | Chain | What happens |
| --- | --- | --- |
| Full Project Lifecycle | `architect → swe-pro → pr-reviewer → swe-pro` | Spec it, build it, review it, fix it — repeat until green |
| Feature Delivery | `swe-pro → swe-implementation → swe-reviewer` | Plan and implement, write tests, get reviewed |
| Bug Investigation | `swe-debugger → swe-security → swe-refactor` | Find the root cause, check for similar vulns, clean up |
| Architecture Change | `architect → arch-migration → swe-database → swe-fullstack` | Design, plan the migration, update the schema, wire the stack |
| Spec-Driven Build | `architect → swe-pro` | Architect writes `plans/`; SWE Pro executes `tasks.md` task by task |
| PR Review | `pr-reviewer → swe-pro` | Review end to end, fix in the order prescribed |
| Production Incident | `swe-debugger → swe-performance → swe-devops` | Diagnose, profile, deploy |

## Updating

```bash
npm update -g swe-pro-agents
```

The installer prunes agents and skills from older versions automatically (via the manifest), so nothing stale lingers. `swe-pro-agents status` shows what changed and warns when a newer version is available.

## Uninstalling

```bash
npm uninstall -g swe-pro-agents
```

The preuninstall hook removes everything this pack installed: the agent files, the pack's skills, and its manifest. Your own skills in `~/.config/opencode/skills/` are never touched. Two things remain by design — they're your content: the `opencode.json` entry referencing the agents path, and any AGENTS.md sections you merged into your global config.

## Development

Plain Node.js (≥ 18), zero dependencies, no build step — the tests are the entry point:

```bash
npm test          # 6 installer lifecycle tests + 18 validator self-tests
npm run validate  # strict pack validation (exits 1 on any violation)
```

The tests simulate install/update/uninstall against a **throwaway `HOME`/`USERPROFILE` directory**, so your real `~/.config/opencode` is never touched. Note that a plain `npm install` in this repo triggers the `postinstall` hook — run tests directly (as CI does) if you don't want the installer to run against your real config. CI runs syntax checks, strict validation, and the full suite on **Linux + Windows × Node 18/20/22**.

```text
SWE-pro-Agents/
├── agents/       26 agent profiles (4 primary, 22 subagents)
├── skills/       9 skills
├── scripts/      install.js (postinstall), uninstall.js (preuninstall), validate.js (pack validator)
├── bin/          swe-pro-agents CLI
├── test/         installer lifecycle tests + validator self-tests
├── .github/      CI workflow
├── AGENTS.md     shared foundation every agent assumes is loaded
└── package.json
```

## Contributing

Bug reports, feature requests, and PRs go through the [GitHub repository](https://github.com/beast-ofcourse/SWE-pro-Agents) — the [issues page](https://github.com/beast-ofcourse/SWE-pro-Agents/issues) is the place to start. Keep new agents lean: every agent file is short *because* it assumes the shared `AGENTS.md` foundation — put cross-cutting rules there, not in each prompt.

## License

MIT — use it, fork it, ship it. See [LICENSE](LICENSE).