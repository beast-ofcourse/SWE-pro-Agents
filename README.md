# SWE Pro Agents

<div align="center">

[![npm version](https://img.shields.io/npm/v/swe-pro-agents?color=blue&style=flat-square)](https://www.npmjs.com/package/swe-pro-agents)
[![npm downloads](https://img.shields.io/npm/dt/swe-pro-agents?style=flat-square)](https://www.npmjs.com/package/swe-pro-agents)
[![license](https://img.shields.io/github/license/beast-ofcourse/SWE-pro-Agents?style=flat-square)](LICENSE)
[![agents](https://img.shields.io/badge/agents-49-success?style=flat-square)](#agents)
[![skills](https://img.shields.io/badge/skills-8-ff69b4?style=flat-square)](#skills)

**49 production-grade OpenCode subagent profiles + 8 skills — deploy a full engineering team in your terminal.**

</div>

---

## Table of Contents

- [Why This Exists](#why-this-exists)
- [Install](#install)
- [Quick Start](#quick-start)
- [Agents](#agents)
- [Skills](#skills)
- [Workflows](#workflows)
- [Updating](#updating)
- [Agent Philosophy](#agent-philosophy)
- [License](#license)

---

## Why This Exists

Most AI coding assistants start blank. No domain expertise, no engineering discipline, no architectural judgment — just a raw model and your prompt. Every session is ground zero.

SWE Pro Agents fixes that. Each agent is a **loaded expert** — a complete system prompt with tool permissions, behavioral rules, error handling patterns, and engineering conventions baked in. You don't ask a model to "review this PR." You invoke `swe-reviewer` — an agent that already knows how to assess blast radius, flag security issues, and enforce your team's standards.

What you get:

- **Consistency** — every agent produces disciplined output, not random good intentions
- **Depth** — agents carry domain knowledge that would take paragraphs to prompt each time
- **Team structure** — 49 specialized roles that divide and conquer, not one monolithic chat

---

## Install

```bash
npm install -g swe-pro-agents
```

This copies all 49 agent profiles to `~/.config/opencode/agents/swe-pro-agents/` and all 7 skills to `~/.config/opencode/skills/`.

Then register the agents with OpenCode by adding to your `opencode.json`:

```json
{
  "agents": [{ "path": "~/.config/opencode/agents/swe-pro-agents" }]
}
```

**That's it.** Restart OpenCode and your entire agent team is ready.

---

## Quick Start

```bash
# Check your installation
swe-pro-agents status

# See the config snippet (if you skipped the step above)
swe-pro-agents setup
```

Once installed, invoke any agent from within OpenCode:

```
@ swe-pro   Plan and implement a rate limiter middleware
@ swe-database  Design the schema for a multi-tenant SaaS app
@ swe-reviewer   Review the last commit for security issues
```

---

## Agents

The team is organized into four squads. Each agent has a focused role, explicit tool permissions, and a curated system prompt optimized for that specific job.

### 🛠️ SWE Agents — Engineering Core

| Agent | Role |
|---|---|
| `swe-api` | API contract design, request/response validation, versioning strategy |
| `swe-backend` | Server-side logic, services, background jobs, integrations |
| `swe-cli` | CLI tooling — argument parsing, subcommands, exit codes, output formatting |
| `swe-database` | Schema design, migrations, query optimization, indexing |
| `swe-debugger` | Root-cause analysis through reproduction, then minimal correct fix |
| `swe-desktop` | Desktop apps — windowing, OS APIs, native packaging |
| `swe-devops` | CI/CD pipelines, containers, infrastructure-as-code |
| `swe-documentation` | READMEs, docstrings, API references, developer guides |
| `swe-frontend` | Components, views, styling, state, animation, client interaction |
| `swe-fullstack` | End-to-end features keeping frontend and backend in sync |
| `swe-git` | Branch management, commit hygiene, rebase, PR preparation |
| `swe-implementation` | General-purpose implementation for well-defined tasks |
| `swe-mobile` | Mobile screens, navigation, platform APIs, on-device perf |
| `swe-opensource` | Licensing, attribution, contribution guidelines, dependency audits |
| `swe-performance` | Profiling, memory optimization, latency reduction — measured, not guessed |
| `swe-planner` | Breaking features into ordered implementation plans with risks and file targets |
| `swe-pro` | Senior engineer — architecture decisions, code review, mentoring |
| `swe-refactor` | Restructuring code for clarity and maintainability without behavior change |
| `swe-release` | Versioning, changelogs, publishing — cutting clean releases |
| `swe-repository` | Mapping unfamiliar codebases — structure, conventions, build commands |
| `swe-reviewer` | Read-only code review — correctness, risk, standards enforcement |
| `swe-security` | Vulnerability auditing, threat modeling, unsafe pattern detection |
| `swe-testing` | Unit, integration, and e2e tests — coverage analysis, flakiness detection |

### 🔬 Research Agents

| Agent | Role |
|---|---|
| `researcher` | Deep investigation on complex technical topics |
| `web-researcher` | Real-time web research for current information |
| `report-generator` | Structured report creation from findings |

### 🔍 Code Analysis Agents

| Agent | Role |
|---|---|
| `codebase-searcher` | Fast file and pattern matching across the codebase |
| `context-analyzer` | Deep context extraction and code understanding |
| `dependency-investigator` | Dependency graph analysis and risk assessment |
| `documentation-reader` | Automated documentation parsing and extraction |
| `evidence-verifier` | Cross-referencing claims against source of truth |
| `experiment-runner` | Controlled experiment design and execution |
| `git-history-analyst` | Git log forensics and change pattern analysis |
| `issue-discussion-analyst` | Issue triage and discussion pattern extraction |
| `repo-investigator` | Full repository structure mapping |

### 🏗️ Architecture Agents

| Agent | Role |
|---|---|
| `architect` | System design — trade-offs, constraints, decisions |
| `arch-api-design` | REST/GraphQL contract design, breaking change detection |
| `arch-architecture-review` | Holistic architecture assessment and risk analysis |
| `arch-database-design` | Schema design, data modeling, normalization trade-offs |
| `arch-design-patterns` | Pattern selection and application guidance |
| `arch-distributed-systems` | Consistency, partitioning, consensus, failure modes |
| `arch-migration` | Incremental migration planning with rollback strategies |
| `arch-rfc` | RFC authoring with structured decision records |
| `arch-scalability` | Load analysis, bottleneck identification, scaling strategy |
| `arch-solution-design` | End-to-end solution design with explicit trade-off documentation |
| `arch-system-design` | High-level system architecture and component interaction |
| `arch-tech-debt` | Debt identification, prioritization, and remediation planning |
| `arch-technical-strategy` | Long-term technology roadmap and decision framework |
| `architecture-mapper` | Architecture diagram generation and system visualization |

---

## Skills

Beyond agents, SWE Pro Agents ships **8 skills** — a staged engineering pipeline plus a token-compression mode, each loadable on demand via OpenCode's `skill` tool. Each skill is a focused `SKILL.md` with its own instructions:

```
swe-pipeline (entry point)
    |
  repository        -- get oriented before touching anything
    |
  planner (optional) -- skip for small, well-understood tasks
    |
  specialists        -- do the actual implementation work
    |
  reviewer           -- read-only check of the diff
    |
  testing            -- write/run tests, confirm the change holds
    |
  return             -- one consolidated report back to the user
```

Skills auto-install to `~/.config/opencode/skills/` and are picked up by OpenCode automatically — no config needed. Just start working and OpenCode's skill tool offers `swe-pipeline` and `caveman` when relevant.

| Skill | Stage | Purpose |
|---|---|---|
| `swe-pipeline` | Entry | Maps the task through all stages |
| `repository` | Orientation | Read-only codebase map before any change |
| `planner` | Planning | Ordered implementation plan (optional) |
| `specialists` | Implementation | Routes work by domain (backend/frontend/general) |
| `reviewer` | Review | Read-only diff review |
| `testing` | Testing | Write + run tests, report real results |
| `pipeline-return` | Return | One consolidated report to the user |
| `caveman` | Communication | Ultra-compressed mode, cuts output tokens ~65% |

---

These agents are designed to **chain together**. Here are real workflows:

### Feature Delivery

```
swe-planner → swe-implementation → swe-testing → swe-reviewer
```

Plan the work, implement, write tests, get reviewed. No context lost between steps.

### Bug Investigation

```
swe-debugger → swe-security → swe-refactor
```

Find the root cause, check for similar vulnerabilities, clean up the code.

### Architecture Change

```
architect → arch-migration → swe-database → swe-fullstack
```

Design the new architecture, plan the migration, update the schema, wire the full stack.

### Production Incident

```
swe-debugger → swe-performance → swe-devops
```

Diagnose the issue, profile the bottleneck, deploy the fix.

---

## Updating

Agents are actively improved — new roles added, prompts refined, permissions tuned.

```bash
npm update -g swe-pro-agents
```

Check what changed:

```bash
swe-pro-agents status
```

---

## Agent Philosophy

Every agent in this collection follows a set of engineering principles:

1. **Read before you write.** Never assume file contents or API contracts — verify first.
2. **Small, verifiable steps.** Make a change, confirm it, move on.
3. **Match existing conventions.** A new pattern needs a stated reason, not a preference.
4. **Minimize blast radius.** The smallest change that correctly solves the task.
5. **Errors are first-class.** Happy-path-only isn't finished.
6. **Leave it better.** No dead code, no debug leftovers, no unexplained TODOs.
7. **Say what you did and why.** Clear communication, not padding.

These aren't suggestions. They're baked into every agent prompt.

---

## License

MIT — use it, fork it, ship it.
