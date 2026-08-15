# Contributing to SWE Pro Agents

Thanks for helping improve the pack. This guide covers how to contribute safely —
every agent and skill here ships to real user configs, so the bar is: **don't
break other people's setups, and don't guess facts.**

- [Development setup](#development-setup)
- [Testing](#testing)
- [The plan-execution loop](#the-plan-execution-loop)
- [Project structure](#project-structure)
- [Adding or changing an agent](#adding-or-changing-an-agent)
- [Adding or changing a skill](#adding-or-changing-a-skill)
- [Changing the installer](#changing-the-installer)
- [Commit conventions](#commit-conventions)
- [Pull request process](#pull-request-process)
- [Changelog policy](#changelog-policy)
- [Security](#security)

## Development setup

Plain Node.js ≥ 18, zero runtime dependencies. There is no build step — the test
suite is the entry point.

```bash
# Clone and verify
git clone https://github.com/beast-ofcourse/SWE-pro-Agents.git
cd SWE-pro-Agents

# Run the installer lifecycle suite
npm test
```

> **Note:** a plain `npm install` in this repo triggers the `postinstall` hook
> (`scripts/install.js`), which copies files into your real
> `~/.config/opencode/`. Run tests directly (`npm test` / `node test/installer.test.js`)
> when you don't want the installer to touch your config.

## Testing

- `npm test` runs the full zero-dependency suite: `test/installer.test.js` (12
  tests — the install/uninstall lifecycle: fresh install, idempotent reinstall,
  stale-file pruning, no-manifest safety, uninstall isolation, manifest-less
  uninstall, and plugin-file handling), `test/validate.test.js` (18 tests — the
  pack validator's self-tests), `test/validate-plan.test.js` (9 tests — the plan
  validator), `test/loop-logic.test.js` (48 tests — the loop's pure logic), and
  `test/run-loop.test.js` (9 tests — the loop runner end to end).
- `npm run validate` runs `scripts/validate.js`, the **strict** pack validator: it
  lints every agent and skill and exits 1 on any violation. The validator is wired
  into CI, so the pack must stay green there too.
- Installer tests redirect `HOME`/`USERPROFILE` to a throwaway temp directory, so
  your real config is never touched. Temp dirs are cleaned up automatically.
- CI (`.github/workflows/ci.yml`) runs syntax checks (`node --check`), strict pack
  validation, and both test suites on **Linux + Windows × Node 18/20/22**.
- If your change alters what the installer copies or removes, extend the test
  suite to cover it — it must stay green.

## The plan-execution loop

The pack ships an autonomous plan-execution loop: `swe-pro` executes
`plans/tasks.md` task by task, recording progress in a ledger. Three pieces are
contributor-facing — the test commands, the plan rules, and the ledger/plugin
machinery:

- **Test commands.** `npm test` runs the full suite (installer lifecycle, pack
  validator, plan validator, loop logic, and loop runner — see
  [Testing](#testing)); `npm run validate` runs the strict pack validator;
  `npm run validate:plan` runs the plan validator (`scripts/validate-plan.js`)
  against `plans/`.
- **Plan rules.** `npm run validate:plan` enforces three rules on a plan
  directory:
  - **P1 — Plan presence:** `tasks.md` exists and contains at least one
    `### T-###` heading.
  - **P2 — Task shape:** every `### T-###` heading has **Build.**, **Acceptance
    criteria.**, and **Verify.** sections (the title falls back to the heading
    text; **Phase.** is optional); task ids are unique.
  - **P3 — Ledger consistency:** if `state.json` exists, its task ids match
    `tasks.md` exactly (no orphans, no missing) and its status is one of
    `running|paused|blocked|done|aborted`.
- **The ledger (`plans/state.json`).** The loop's single source of truth: schema
  version, ledger status, plan file, iteration count, per-task
  `{ id, phase, title, status, attempts, last_verify }`, and the budget
  (2 attempts per task, 40 iterations per run). Ledger statuses are
  `running|paused|blocked|done|aborted`; per-task statuses are
  `pending|in_progress|done|blocked`. **Single-writer rule:** the loop runner
  (`scripts/run-loop.js`) is the only writer — read the ledger before
  dispatching, mark the task `in_progress` before dispatch, and record the
  result after each task, every update via an atomic save (write to `.tmp`,
  rename over). Never hand-edit it.
- **The plugin (`plugins/continuation.js`).** An OpenCode plugin that nudges the
  loop forward: on `session.idle`, when the session's agent is `swe-pro` and the
  ledger reports `running` with a pending task and no `in_progress` task, it
  prompts the session to continue plan execution. Every failure path returns
  silently — the hook never throws.

## Project structure

```text
agents/        Agent profiles (26: 22 subagents + 4 primary)
skills/        Skills: caveman, skill-creator, teach-me, readme-generator, svg-hero-generator, humanizer-pro, flowchart-html, high-quality-flowcharts, opencode-skill-creator, brandkit, design-taste-frontend, design-taste-frontend-v1, full-output-enforcement, gpt-taste, high-end-visual-design, image-to-code, imagegen-frontend-mobile, imagegen-frontend-web, industrial-brutalist-ui, mcp-builder, minimalist-ui, redesign-existing-projects, stitch-design-taste
scripts/       install.js (postinstall), uninstall.js (preuninstall), validate.js (pack validator)
bin/           swe-pro-agents CLI
test/          Installer lifecycle tests + validator self-tests
AGENTS.md      Shared foundation every agent assumes is loaded
```

## Adding or changing an agent

Each agent is one Markdown file in `agents/` with YAML frontmatter:

```yaml
---
description: One sentence describing exactly when to invoke this agent.
mode: subagent            # or "primary" — only for roles users select directly
temperature: 0.2
permission:               # scoped tool access; deny by default where it matters
  edit: allow             # or "deny" for read-only roles
  bash: ask
  task:
    '*': deny
---
```

Rules:

- **Keep agents lean.** Agent files state only domain-specific behavior. The
  shared Engineering Operating System — Core priorities, Engineering rules,
  Completion checklist, Reporting format — lives once in `AGENTS.md`; do not
  repeat it in every agent.
- **Permissions match the role.** Read-only agents (review, security, research)
  get `edit: deny` and narrow `bash`; implementers get scoped allow-lists.
- **Keep counts in sync.** The roster appears in `package.json` (description),
  the README agent tables, and this structure map — and it is enforced by
  `npm run validate` (counts are integrity-checked against `package.json` and the
  README in CI). Changing the roster means updating all three and keeping the
  validator green.
- If the change is behavior users rely on, add a CHANGELOG entry (see below).

## Adding or changing a skill

A skill is a directory under `skills/` containing a `SKILL.md` (with `name`,
`description`, and `license` in frontmatter) plus any scripts/references it needs.

- **Skills must be self-contained.** Unlike agents, they cannot assume `AGENTS.md`
  is loaded — a skill can run in any project, including ones without this pack
  installed.
- Scripts ship cross-platform (the pack supports Windows, macOS, Linux) — verify
  any helper runs on Windows, where consoles often use legacy encodings.
- The installer discovers skills by directory + `SKILL.md`; nothing else needs
  registration.

## Changing the installer

`scripts/install.js` (postinstall) and `scripts/uninstall.js` (preuninstall)
form a contract:

- Ownership is tracked in `~/.config/swe-pro-agents/manifest.json`. Never remove
  files the manifest didn't record — the installer never guesses ownership, and
  neither should you.
- Uninstall must only ever remove pack-owned files. User skills in
  `~/.config/opencode/skills/` and user-merged `AGENTS.md` content are
  inviolable.
- The pack's `AGENTS.md` is deliberately never written over a user's global
  `~/.config/opencode/AGENTS.md` — don't "fix" that.
- The pack's `AGENTS.md` copy lives in `~/.config/swe-pro-agents/`, never
  inside the agents dir — OpenCode loads every `.md` in a registered agents
  path as an agent profile, so an `AGENTS.md` there becomes a phantom agent.
- Every lifecycle change needs corresponding coverage in `test/installer.test.js`.

## Commit conventions

Conventional Commits, matching the repo history:

```text
feat: add new capability
fix: correct broken behavior
docs: documentation only
test: tests or CI
refactor: behavior-preserving restructure
chore: tooling, metadata, housekeeping
polish: prompt/agent wording refinement
release: version bumps and release notes
```

One logical change per commit. No secrets, no unrelated files.

## Pull request process

1. Branch off `main`; open the PR against `main`.
2. CI must pass on Linux and Windows for the supported Node versions.
3. CodeRabbit reviews PRs automatically — address its findings (it's usually
   right about security, correctness, and docs hygiene; push a fix commit and
   reply on the thread).
4. Behavioral changes add a `## [Unreleased]` entry to `CHANGELOG.md`.
5. Update README/docs if the change affects install, usage, or agent roster.

## Changelog policy

- Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning:
  [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
- User-visible changes go under `## [Unreleased]` in `Added` / `Changed` /
  `Fixed` / `Removed` / `Security` as appropriate.
- The maintainer moves `[Unreleased]` into a versioned section at release time —
  don't create version headings yourself.

## Security

- Report vulnerabilities privately via GitHub's private vulnerability reporting
  (the **Security** tab on the repository) rather than a public issue.
- Never commit credentials, tokens, or personal data — in code, tests, or docs.
- If a fix touches authentication, secrets handling, or trust boundaries,
  say so in the PR description.
