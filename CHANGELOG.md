# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- `arch-scalability` + `arch-strategy` merged into new subagent `arch-validator` — its sole mission is attacking Architect's finished plan: it stress-tests every decision, task, and user journey and returns categorized Critical/Major/Minor spec fixes to `plans/validation.md`. Architect now runs the validator before handoff and must address all Critical/Major findings. Pack is now 25 profiles (22 subagents + 3 primary); README, package.json, and demo SVGs updated accordingly
- `architect` rebuilt as a spec-driven planner: it now opens with a spec-vs-**yolo** choice (yolo = architect decides the stack and everything else, zero questions), interviews across an 11-area spec checklist, and produces exactly three files in `plans/` — `project-overview.md`, `tasks.md` (phases of small, independent, verifiable tasks executable by SWE Pro alone), and `user-flow.md` (the app from the user's point of view). SWE Pro and `AGENTS.md` updated to make `plans/tasks.md` the source of truth for build work
- `swe-testing` merged into `swe-reviewer` — the pack's testing discipline (isolation, mocking at boundaries, fixtures, failure paths, coverage-as-finding) now lives in the reviewer's Phase 6 "Testing craft" section, so verification and review are owned by one agent. Pack is now 26 profiles (23 subagents + 3 primary); delegation list, README, package.json, and demo SVG updated accordingly

### Added
- `teach-me` skill — adaptive tutoring with explanations, quizzes, exercises, and persistent mastery tracking (`learning_progress_*.md` files)
- `skill-creator` skill — the craft and workflow for writing great skills: merges Matt Pocock's `writing-great-skills` (predictability, invocation, information hierarchy, leading words, pruning) with Anthropic's `skill-creator` (draft → test → evaluate → iterate → package)

## [2.1.1] - 2026-08-02

### Added
- Installer lifecycle smoke tests (`test/installer.test.js`): fresh install, idempotent reinstall, stale-file pruning, uninstall safety — all run against a throwaway HOME directory
- CI matrix (`.github/workflows/ci.yml`): Linux + Windows × Node 18/20/22, syntax checks + installer tests
- CI security hardening: read-only `contents` permission and `persist-credentials: false` on checkout
- `.gitattributes` line-ending normalization; `.gitignore` entries for reviewer artifacts (`.worktrees/`, `review-report.md`, `handoff.md`)
- README: CLI reference, "What You Get" features list, development/testing section, Windows install note, CI badge
- `CONTRIBUTING.md` and this changelog

### Changed
- `swe-reviewer` promoted from subagent to primary agent; `AGENTS.md` condensed (Critical Thinking Framework, Constitution, Definition of Done, Handoff protocol)
- `svg-hero-generator` restructured from a single packaged file to a directory skill (install.js compatible) with 3 demo hero banners, an SVG template, and construction rules
- README refactored: accurate agent counts (24 subagents + 3 primary), tightened structure, verified badges
- `package.json` description aligned with the 24 + 3 agent layout

### Fixed
- `generate_tree.py` crashed on Windows consoles (cp1252) printing box-drawing characters — stdout now forces UTF-8
- `svg-hero-generator` SKILL.md: invalid `1280 400` viewBox example replaced with the full `viewBox="0 0 1280 400"`; removed stale "(see file-creation guidance below)" reference
- Installer tests no longer leak temp HOME directories (tracked and removed at process exit, including on failure)
- Unlabelled code fences flagged by markdownlint (MD040) in README and agent files
- `swe-reviewer` worktree setup now resolves the target to a commit SHA and adds the worktree detached, so reviews work even when the target branch is checked out in the caller's worktree

## [2.1.0] - 2026-08-02

### Added
- Manifest-based install lifecycle: `~/.config/swe-pro-agents/manifest.json` records exactly what the pack installed; updates prune stale agents/skills, uninstall removes only pack-owned files
- `swe-pro-agents setup --apply` — writes the `opencode.json` agents entry (backs up the existing config to `.bak` first)
- `swe-pro-agents status` — installation state plus npm registry update check (offline-safe, 5s timeout)

### Changed
- README hero image replaced with PNG banner

## [2.0.0] - 2026-08-02

### Added
- `readme-generator` skill — professional READMEs generated from repository evidence
- `svg-hero-generator` skill — repo-aware SVG hero banners

### Changed
- Agent roster consolidated 45 → 33 → 27 profiles (Architect squad merged 14 → 10, overlapping agents merged, research squad dropped)
- Skills trimmed from 10 to 3 standalone utilities; pipeline skills removed
- README overhaul: categorized agent tables, workflow examples, agent philosophy
- markdownlint warnings cleared in README

## [1.2.3] - 2026-07-09

Version bump only — no functional changes.

## [1.2.2] - 2026-07-09

### Added
- `caveman` token-compression skill
- 7 delivery pipeline skills (removed again in 2.0.0)

### Changed
- Agent prompts compressed and restructured into a subdirectory
- `swe-frontend` design-system documentation

## [1.1.0] - 2026-07-08

### Added
- First npm-published release
- Installable package structure with `swe-pro-agents` CLI (`setup`, `status`, `version`, `teams`, `help`)
- 49 specialized agent profiles, plus an autonomous engineering team of 10 agents (later split into its own repository)
- Professional README with categorized tables, workflow examples, and agent philosophy
