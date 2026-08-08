# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- 13 new design/image-generation skills — pack is now **22 skills** (was 9):
  - `brandkit` — premium brand-kit image generation (guidelines boards, logo systems, identity decks)
  - `design-taste-frontend` — anti-slop frontend skill for landing pages, portfolios, and redesigns
  - `design-taste-frontend-v1` — original v1 taste-skill, preserved for exact backward compatibility
  - `full-output-enforcement` — overrides LLM truncation; complete code, no placeholders
  - `gpt-taste` — Awwwards-level UX/UI with GSAP motion (randomization, AIDA structure, ScrollTriggers)
  - `high-end-visual-design` — high-end agency design rules (fonts, spacing, shadows, animations)
  - `image-to-code` — image-first website design-to-code workflow
  - `imagegen-frontend-mobile` — premium mobile app screen concepts and flows (images only)
  - `imagegen-frontend-web` — premium website design references, one horizontal image per section
  - `industrial-brutalist-ui` — raw mechanical interfaces (Swiss print × military terminal)
  - `minimalist-ui` — clean editorial-style interfaces
  - `redesign-existing-projects` — upgrade existing sites/apps to premium quality
  - `stitch-design-taste` — semantic design system for Google Stitch (`DESIGN.md` files)
  - `mcp-builder` — build high-quality MCP servers: tool design, TypeScript/Python SDKs, MCP Inspector testing, and evaluation creation (adapted from Anthropic's MIT-licensed mcp-builder skill)
- Validator, package.json, README, and CONTRIBUTING updated to match (23 skills)

## [2.3.0] - 2026-08-08

### Added
- `flowchart-html` skill — professional flowcharts, process diagrams, decision trees, and org charts as a single self-contained HTML file on a large SVG canvas
- `high-quality-flowcharts` skill — publication-grade, print-ready PDF flowcharts/roadmaps via HTML/CSS shells with inline SVG geometry, PDF export, and a verification preview
- `opencode-skill-creator` skill — create, test, evaluate, optimize, and package OpenCode skills (evals, benchmarks, description tuning)
- Pack is now **9 skills** (was 6); validator, package.json, README, and uninstall docs updated to match

### Changed
- `AGENTS.md` restructured into the **Engineering Operating System (EOS)**: titled and sectioned by Core priorities, Prime directive, Cost-efficiency rules, Reasoning protocol, Engineering rules, Execution protocol, Verification standard, Delegation protocol, Architecture boundary, Planning contract, Hard gates, Completion checklist, Reporting format, Stop conditions, Project notes. Old section names (Constitution, Critical Thinking Framework, Definition of Done, Handoff protocol) removed. README, installer, CLI, CONTRIBUTING, and changelog references updated to point at the new structure.
- `swe-frontend` restructured into phases with a **Playwright MCP browser verification loop** — builds, then navigates, screenshots, clicks, resizes, and breaks the running app in a real browser (failure paths included), and never claims a UI is done on a passing typecheck. New dependencies now require approval first (pinned, with lockfile/license/advisory checks)
- `swe-pro` now routes **all UI work to `swe-frontend`** — never `swe-implementation` and never itself; mixed UI/non-UI tasks are split so the UI part is owned by `swe-frontend`
- **Parallel dispatch hardened**: independence verified from the full plan, repo file set, and generated outputs (not task text alone); batches of 3–4 tasks per response; overlapping results discarded/reconciled and rerun sequentially
- **CodeRabbit fixes** (17 findings on PR #14): dependency-approval flow, Playwright MCP network capability documented, flowchart skills hardened (system fonts only, keyboard-accessible pan/zoom, literal SVG colors for PDF export, no runtime package installs)
- README condensed for scannability with a News section mirroring the changelog

## [2.2.0] - 2026-08-04

### Added
- `humanizer-pro` skill — sharp human editor that rewrites drafts to read human or detects AI-slop with quoted evidence. Merges two MIT skills: petergyang/no-ai-slop and blader/humanizer (33-pattern catalog from Wikipedia's "Signs of AI writing", voice calibration). Pack is now 6 skills
- `pr-reviewer` — new CodeRabbit-inspired **primary** agent: reviews GitHub PRs end to end, flags every finding as Critical / Major / Minor / Optional with a concrete fix, verifies checkable findings in an isolated worktree, and writes `PR-review.md`. Pack is now 26 profiles (22 subagents + 4 primary)
- `teach-me` skill — adaptive tutoring with explanations, quizzes, exercises, and persistent mastery tracking (`learning_progress_*.md` files)
- `skill-creator` skill — the craft and workflow for writing great skills (draft → test → evaluate → iterate → package)
- **Verification harness** — `scripts/validate.js` (zero-dependency, run as `npm run validate`) statically validates every agent and skill and fails the build on any violation. Wired into CI (Linux + Windows × Node 18/20/22) with 18 self-tests in `test/validate.test.js`; `npm test` now runs both suites

### Changed
- **Finishing work ceremony**: SWE Pro re-runs the full suite on the exact tree to be integrated, confirms the base branch, presents exactly three options (merge locally / push and open a PR / keep as-is), and cleans up only worktrees it owns
- **Parallel task dispatch**: independent tasks in the same phase run concurrently, one fresh subagent each, with overlap checks and a full-suite run before integration
- **Subagent-driven plan execution**: SWE Pro dispatches each `plans/tasks.md` task to a fresh subagent with only the task text, then reviews in two passes (spec compliance + code quality). `tasks.md` tasks must pass the **fresh-session bar**
- **Hard gates**: a red test baseline stops implementation before it starts; unresolved Critical findings block the next task
- **Phase checkpoints**: SWE Pro pauses after each `tasks.md` phase for user approval, unless told "auto-pilot"
- **Red flags** sections added to SWE Pro and PR Reviewer
- **Process announcements** added to the shared `AGENTS.md` foundation (now the Engineering Operating System)
- `architect` rebuilt as a spec-driven planner with spec-vs-yolo choice, 11-area spec checklist, and three plan files (`project-overview.md`, `tasks.md`, `user-flow.md`)
- `arch-scalability` + `arch-strategy` merged into `arch-validator` — stress-tests every Architect decision and returns categorized spec fixes
- `swe-testing` merged into `swe-reviewer` — verification and review owned by one agent
- `svg-hero-generator` now declares `compatibility: opencode`

## [2.1.1] - 2026-08-02

### Added
- Installer lifecycle smoke tests (`test/installer.test.js`): fresh install, idempotent reinstall, stale-file pruning, uninstall safety — all run against a throwaway HOME directory
- CI matrix (`.github/workflows/ci.yml`): Linux + Windows × Node 18/20/22, syntax checks + installer tests
- CI security hardening: read-only `contents` permission and `persist-credentials: false` on checkout
- `.gitattributes` line-ending normalization; `.gitignore` entries for reviewer artifacts (`.worktrees/`, `review-report.md`, `handoff.md`)
- README: CLI reference, "What You Get" features list, development/testing section, Windows install note, CI badge
- `CONTRIBUTING.md` and this changelog

### Changed
- `swe-reviewer` promoted from subagent to primary agent; `AGENTS.md` condensed (the shared foundation that later became the Engineering Operating System)
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
