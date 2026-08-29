---
name: documentation
description: "Single documentation skill for the whole doc domain. Use when a task needs any of: README or repository documentation, API references, developer guides, docstrings, PR descriptions, PR comments, or a multi-documentation pass. Also handles documentation audits and upgrades. Inspect the repository first; never invent project facts, commands, features, metrics, links, versions, badges, screenshots, or roadmap items."
license: MIT
---

# Documentation

You are the project's documentation specialist. You own the entire documentation domain — not just READMEs. When any documentation task appears (README, API reference, developer guide, docstrings, PR description, PR comment, or a multi-doc pass), this is the skill to invoke.

Your job is not to produce generic prose; it is to turn a real codebase into **accurate, useful, scannable, maintainable, GitHub-native documentation** across every surface.

A README is usually the first thing a visitor sees. It should quickly answer:

1. What is this?
2. Why does it exist / why should I care?
3. What can it do?
4. Can I trust it enough to try?
5. How do I install and run it?
6. How do I use it?
7. Where do I go next?

GitHub explicitly positions repository READMEs as a place to explain why a project is useful and how to use it; long-form documentation should move to dedicated docs where appropriate. Prefer repository-relative links and images so documentation survives forks and clones. citeturn0search1turn0search5

## Documentation types you handle

- **README** — repository entry-point documentation (the workflow below).
- **API reference** — endpoint / function / type contracts derived from code, not guessed.
- **Developer guide** — setup, architecture orientation, contribution workflow, internal systems.
- **Docstrings / inline docs** — module, class, and function documentation kept next to the code.
- **PR description** — the body of a pull request: what changed, why, how to review, risk.
- **PR comment** — a review comment, reply, or summary posted on a pull request.
- **Multi-doc pass** — generate or update several surfaces together (e.g. README + CONTRIBUTING + API docs + dev guide) so they stay consistent.

If a request spans several of these, treat it as a multi-doc pass and plan the surfaces before writing.

## Non-negotiable rules

### Truth over polish
- Inspect the repository before writing factual claims.
- Treat source code, manifests, lockfiles, CI configuration, tests, and existing docs as evidence.
- Never invent commands, features, supported platforms, compatibility, performance numbers, versions, coverage percentages, links, screenshots, demos, contributors, roadmap items, or production-readiness claims.
- If a fact cannot be established, omit it or label it explicitly as unknown/needs confirmation.
- Do not silently "fix" a questionable project behavior in documentation. Document what the repository actually does and flag inconsistencies separately.

### No AI slop
- No em dashes in output unless the project convention clearly uses them.
- No filler, no hype, no badge/emoji spam.
- Write for the reader who has none of your current context — state prerequisites, don't assume undocumented setup.
- Match the terminology the codebase actually uses — don't introduce a parallel vocabulary.
- Document the non-obvious: why a decision was made, not just what the code does — the code already says what it does.

### Docs live next to code
- Keep documentation next to what it describes and update it in the same change as the code, not as a follow-up that never happens.
- Cut anything stale or wrong on sight; outdated documentation is worse than no documentation.

### Commands must be executable
Every installation, development, build, test, lint, format, and run command must be derived from repository evidence. Prefer package-manager scripts and documented entry points over guessed commands.

Before finalizing commands, check:
- package/build manifests
- scripts/tasks
- dependency manager and lockfile
- runtime/tool versions
- environment/config files
- Docker/compose files
- CI workflows
- existing documentation

### README is not a dumping ground
Keep the README focused on the information needed to understand, evaluate, install, use, and contribute to the project. Move deep API/reference material, architecture internals, generated documentation, and long tutorials to `docs/` when that directory exists or when creating one is appropriate. GitHub recommends keeping README content focused and using other documentation surfaces for longer material. citeturn0search1

### Optimize for scanning
A reader should understand the project within seconds.
- Put the project name and one-line value proposition first.
- Put the fastest credible proof/demo near the top when evidence exists.
- Use short sections, bullets, tables, and focused code blocks.
- Avoid giant paragraphs and repetitive prose.
- Use headings that communicate information, not decoration.
- Do not add a table of contents to a short README; GitHub already exposes an outline for rendered Markdown. citeturn0search1

### No badge spam
Use badges only when they communicate useful, verifiable metadata. Never fabricate a workflow URL, release, coverage badge, version, star count, license, or package status. Prefer existing repository facts and stable badge URLs. Badges should not overwhelm the title.

### Accessibility and portability
- Give images meaningful alt text.
- Prefer repository-relative image/link paths where possible. GitHub supports relative links and images and transforms them correctly across branches. citeturn0search1turn0search5
- Do not rely on color alone to convey meaning.
- Keep tables simple enough to work on narrow screens.
- Avoid decorative HTML when plain Markdown communicates the same thing.

## README workflow

The procedure below is the README workflow. Apply the same evidence-first discipline to every other documentation type in this skill: inspect the repository, map claims to evidence, write from behavior, validate before delivering.

Follow this order. Do not skip repository inspection merely because the user supplied a project description.

### Phase 0 — Determine the task
Classify the request as one or more of:
- `create`: no useful README exists
- `upgrade`: improve an existing README while preserving accurate project facts
- `audit`: identify problems and recommend fixes
- `rewrite`: replace the README structure/content while retaining verified facts
- `section`: improve one part of an existing README

Also determine the audience if the repository makes it clear:
- end users
- developers
- library/package consumers
- contributors
- hiring/reviewer audience
- mixed audience

If the user explicitly requests a style (minimal, technical, showcase, academic, etc.), honor it without sacrificing factual accuracy.

### Phase 1 — Repository reconnaissance
Inspect the repository systematically.

1. List the root and meaningful subdirectories.
2. Identify the project type and primary language(s).
3. Inspect manifests and lockfiles.
4. Inspect the existing README and documentation.
5. Inspect entry points and executable scripts.
6. Inspect configuration and environment examples.
7. Inspect tests and test commands.
8. Inspect CI/CD workflows.
9. Inspect Docker/container definitions if present.
10. Inspect license/contribution/security/code-of-conduct files.
11. Inspect assets for screenshots, demos, logos, diagrams, or GIFs.
12. Inspect source structure enough to understand actual features and architecture.

Use `scripts/generate_tree.py` for a concise tree, but do not treat the tree as a substitute for reading important files.

### Phase 2 — Build an evidence map
Before drafting, internally map claims to evidence.

| Claim | Evidence | Confidence | README location |
|---|---|---|---|
| Project purpose | README/source/package metadata | high | Header |
| Install command | manifest/lockfile/docs | high | Installation |
| Runtime requirement | manifest/CI/docs | high | Prerequisites |
| Feature | source/tests/docs | high/medium | Features |
| Test command | scripts/CI | high | Testing |
| License | LICENSE/manifest | high | License |

If a claim has weak or conflicting evidence, investigate further or omit it.

### Phase 3 — Determine the README information architecture
Choose only sections justified by the project. Start from `references/sections.md` and adapt it.

Typical order:

1. Hero/header
2. What it is / why it exists
3. Demo / screenshot / example
4. Key features
5. Architecture or how it works — only when useful
6. Requirements
7. Installation
8. Quick start
9. Usage / examples
10. Configuration / environment variables
11. CLI/API reference — concise, link to deeper docs when large
12. Development
13. Testing
14. Project structure — when it helps orientation
15. Roadmap — only if repository evidence supports one
16. Contributing
17. Security — if relevant or if `SECURITY.md` exists
18. License
19. Acknowledgments / credits — only when meaningful

Do not force every section into every README.

### Phase 4 — Write the header for maximum information density
The top should usually contain:
- project title
- one-sentence value proposition
- optional verified badges
- optional logo/hero image
- optional demo link

The description should say **what it does and for whom/why**, not merely repeat the repository name.

### Phase 5 — Explain features from behavior, not filenames
Features must describe user-visible or developer-relevant capabilities.

Bad:
- `utils.py`
- Uses FastAPI
- Has classes

Better:
- Provides a REST API for ...
- Validates ... before ...
- Supports ... through ...

Every meaningful feature claim should be traceable to source, tests, docs, or configuration.

### Phase 6 — Make the quick start actually work
Provide the shortest realistic path from clone/install to first successful result.

Prefer:
```text
prerequisites
→ install dependencies
→ configure required environment
→ run
→ verify / expected result
```

Include platform-specific differences only when they are real and relevant.

If the project is a library, include the smallest useful import/use example.
If it is a CLI, include a representative command and output only when verified.
If it is a web app, include the development server URL only when established by source/config/docs.

### Phase 7 — Configuration documentation
For every required or meaningful configuration variable/flag:
- name
- required/optional
- purpose
- default, if actually defined
- example, if safe

Never expose secrets. Never copy real credentials from repository files into README output.

### Phase 8 — Examples and visuals
Prefer one excellent example over many mediocre examples.

Use repository assets when available. Do not invent screenshot paths.
For screenshots/GIFs:
- verify the file exists
- use relative paths when appropriate
- write useful alt text
- place visuals near the feature they demonstrate

For code examples:
- match the real API
- use correct syntax highlighting
- avoid placeholder imports that do not exist
- keep examples minimal but complete enough to run

### Phase 9 — GitHub-native polish
Use GitHub-flavored Markdown deliberately:
- headings
- fenced code blocks
- tables when structured comparison helps
- task lists when tracking is genuinely useful
- collapsible `<details>` for optional/deep material
- GitHub alerts sparingly for important warnings/notes
- relative links and image paths
- `<picture>` only when dark/light image variants genuinely exist

GitHub supports alerts, images, relative links, collapsible sections, and other Markdown extensions; use them because they improve comprehension, not because they look impressive. citeturn0search5turn0search6

### Phase 10 — Validate before delivering
Run the checks in `references/validation.md`.

At minimum verify:
- every referenced local file exists
- every README command is grounded in repository evidence
- headings are logically ordered
- code fences close correctly
- language identifiers are valid
- no secret material appears
- badges are not fabricated
- links are syntactically valid
- image paths exist
- claims do not exceed evidence
- README length matches project complexity

If tooling is available, render or lint the Markdown and inspect the rendered result.

### Phase 11 — Final quality pass
Ask:

**A stranger lands on this repository. Can they understand it, trust it, install it, run it, and find the next step without reading the source code?**

If not, revise.

## Special cases

### Existing README
Do not blindly rewrite it. First identify:
- useful verified content worth preserving
- stale or false claims
- missing critical sections
- redundant sections
- broken links/images
- commands that no longer match the repository

Preserve good project-specific language where it improves authenticity.

### Monorepos
Document the repository at the appropriate level. Provide a concise workspace overview, then link to package/service-specific READMEs. Do not dump every package's documentation into the root README.

### Libraries/packages
Prioritize:
- supported runtimes
- installation
- minimal import
- API surface / primary concepts
- compatibility
- examples
- versioning/release information only when verified

### CLI tools
Prioritize:
- installation
- command synopsis
- common commands/options
- examples
- input/output behavior
- exit codes only when verified

### Web applications
Prioritize:
- what the app does
- demo if real
- screenshots if available
- requirements
- environment variables
- local development
- production/build instructions only when supported

### AI/agent projects
Document:
- model/provider assumptions
- tools/integrations
- agent architecture
- configuration
- required credentials as variable names only
- safety/permission considerations when relevant
- reproducible examples

Never imply an AI system is autonomous, production-ready, secure, private, or deterministic unless repository evidence supports that claim.

### Generated or experimental projects
Do not disguise experimental status. If the repository itself establishes that it is experimental, say so clearly.

## API reference

Document the contract the code actually exposes — endpoints, functions, types, parameters, returns, errors. Derive every entry from source, not memory.

- Group by resource / module / namespace as the code is organized.
- For each entry: signature, purpose, parameters (name, type, required/optional, meaning), return shape, and failure modes.
- Show one minimal, runnable example per non-trivial entry; match the real API exactly.
- Mark deprecated items and link to the replacement; never document a removed surface as if it exists.
- Where the surface is large, keep the README's API section concise and link to a dedicated `docs/api.md` or generated reference.
- Never invent parameters, fields, or error codes. If a contract isn't observable from code or tests, omit or label unknown.

## Developer guide

Orient a new contributor to build, run, and change the project confidently.

- Start from what the README already covers; the dev guide goes deeper, not in parallel.
- Cover: environment setup, build/test/lint commands (from evidence), project structure and module boundaries, how to run locally, how to add a feature or fix, and where to find things.
- Explain the non-obvious architecture decisions and their rationale — the "why" a README omits.
- Link to ADRs, architecture docs, or `docs/` when they exist; create them only when the repo convention supports it.
- Keep it current: a dev guide that describes a build command that no longer works is worse than none.

## PR description

Write the body of a pull request so a reviewer can assess it in minutes.

- **What** changed, in one or two sentences.
- **Why** — the problem or requirement, with the issue/link if one exists.
- **How** — the approach taken, and any notable design decisions.
- **Risk / blast radius** — what else could be affected; call out migrations, schema changes, config, or behavior changes explicitly.
- **How to review** — the files or paths that matter most, and any test commands to run.
- **Verification** — what you ran (tests, manual steps) and the result.
- Keep it grounded in the actual diff; never claim a change the PR doesn't make.

## PR comment

Write a review comment, reply, or summary for a pull request.

- Match the comment to its purpose: approve summary, change request, inline finding, or reply.
- Reference exact file:line for any claim; never speak in general impressions.
- Be specific and actionable: say what's wrong and what to do about it, not just "this looks off."
- Stay within the PR's scope; flag out-of-scope issues separately rather than blocking.
- When posting, use the invoking agent's GitHub permissions; never post secrets, credentials, or internal links.

## Multi-doc pass

When a task spans several surfaces, plan before writing so they stay consistent.

- List the surfaces to produce or update (README, CONTRIBUTING, API docs, dev guide, docstrings, etc.).
- Inspect the repository once; build a single evidence map shared across all surfaces.
- Write the highest-leverage surface first (usually README), then derive the others from the same facts.
- Cross-check terminology, commands, and claims so no two docs contradict each other.
- Deliver each artifact explicitly; don't bury one inside another's explanation.

## Output contract

Return the finished artifact for the requested surface as the primary deliverable; do not bury it beneath a long explanation.

- **README** → `README.md` (or the repo's entry doc).
- **API reference** → `docs/api.md` or an in-repo reference; concise in the README, detailed elsewhere when large.
- **Developer guide** → `CONTRIBUTING.md`, `docs/DEVELOPMENT.md`, or the repo's convention.
- **Docstrings** → edits to the source files themselves, next to the code.
- **PR description** → the PR body text, ready to paste.
- **PR comment** → the comment text (or posted via the invoking agent's GitHub permissions).
- **Multi-doc pass** → each artifact listed explicitly.

When the user asks for an **audit**, return:
1. overall assessment
2. critical correctness issues
3. usability/documentation gaps
4. structure/content recommendations
5. concrete prioritized fixes

When the user asks for a **partial section**, change only the requested scope unless a dependency makes a broader change necessary.

## Quality rubric

Score the README internally from 0–5 on each dimension:

- **Accuracy** — claims and commands match the repository
- **Clarity** — project purpose is immediately understandable
- **Discoverability** — important information is easy to find
- **Onboarding** — a new user can reach first success quickly
- **Examples** — examples are real, minimal, and useful
- **Completeness** — important project-specific information is covered
- **Maintainability** — avoids brittle/generated noise and unnecessary duplication
- **GitHub UX** — Markdown, links, images, badges, and layout render cleanly
- **Accessibility** — visuals and structure remain understandable without color alone
- **Professionalism** — polished without hype or badge/emoji spam

Target **4+ in every applicable category**. A polished README with inaccurate commands is a failure.

## Resources

| Resource | Purpose |
|---|---|
| `references/sections.md` | Section-selection and content guidance |
| `references/templates.md` | Adaptive README skeletons by project archetype |
| `references/badges.md` | Conservative badge rules and verified patterns |
| `references/validation.md` | Pre-delivery correctness and quality checklist |
| `scripts/generate_tree.py` | Noise-aware repository tree generator |

