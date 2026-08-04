---
name: svg-hero-generator
description: "Generate editable, repo-aware SVG hero/banner images for README files. Use whenever a user wants a README banner, GitHub social preview, project header image, or asks for an SVG (not raster/PNG) hero graphic — especially if they want it to reflect their actual project rather than generic stock-style art. Also use when a user wants a few distinct visual directions to choose between before committing to a final banner. Trigger on phrases like 'hero image for my README', 'banner for this repo', 'make an SVG header', or 'social preview image', even if they don't say 'SVG' explicitly."
license: MIT
compatibility: opencode
---

# SVG Hero Image Generator

Creates editable, information-dense SVG hero images for README files — the opposite of abstract art. Every element on the banner should trace back to a real, verifiable fact about the repository: its name, its stack, its purpose, its badges. Nothing decorative for decoration's sake, nothing invented.

This is a **communication design** task, not a generative-art task: the goal is instant legibility of who this project is, not an emergent aesthetic experience. If the repo is sparse or unknown, say so and default to the safest minimal direction rather than inventing facts to fill space.

## Workflow

This happens in three passes. Do not skip ahead to rendering — the whole value of this skill is that the banner is *earned* by inspecting the repo first, not guessed at.

### Pass 1 — Inspect the repository

Before proposing anything, gather real signals using your actual tools (`view`, `bash_tool`), not by guessing:

- Read `README.md` if present — title, tagline, badges, tone of the prose.
- Check for manifest/build files that reveal the stack: `package.json`, `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, `build.gradle*`, `Dockerfile`, `docker-compose.*`, `.github/workflows/*`.
- Look for existing brand signals: a logo, favicon, existing `/assets`, `/docs`, `/public`, `/static` images, or a color already used somewhere (badge colors, existing SVGs).
- Note the project's apparent tone — experimental hobby project, hacker CLI, polished commercial library, academic tool, enterprise platform — since this drives typography and density, not just color.

Run `scripts/repo_signals.py <path>` to get a fast structured summary (important files present, candidate existing image assets, a shallow file tree) instead of manually walking the tree yourself. Then read the specific files it surfaces (especially `README.md` and the manifest file) directly, since the script only tells you *what exists*, not what it says.

If no repo path is given or the user is describing a project verbally instead of pointing at a folder, work from what they tell you directly and say you're doing so — don't fabricate a stack or feature set they never mentioned.

### Pass 2 — Propose 3–4 concept directions

Do not render a final SVG yet. Synthesize what Pass 1 found into 3–4 **meaningfully different** directions — see `references/concepts.md` for the standard families (terminal banner, architecture diagram, editorial title card, geometric signal card) and when each fits.

For each option give: a short name, the visual idea in one line, why it fits *this specific repo* (cite what you found, not a generic reason), 2–3 concrete visual traits, and one honest risk/tradeoff. Keep the whole set scannable — this is a menu, not four essays.

If the user asks you to just pick one, choose the strongest repo-fit direction and say why in a sentence, then proceed to Pass 3 immediately.

### Pass 3 — Render the final SVG

Once a direction is chosen (or you've picked one per above):

1. Load `assets/hero_template.svg` and `references/svg_rules.md` before writing markup — the template is a working scaffold (viewBox, grid, grouped layers, type baselines already wired up) and the rules file has the concrete spacing/contrast/sizing numbers. Build from the template rather than starting from a blank `<svg>` tag.
2. Fill in real repo facts only — title, one subtitle line, at most a handful of short fact-chips (stack, license, key feature). Never invent metrics, star counts, or capabilities the repo doesn't show.
3. Run through `references/checklist.md` before delivering. Do not deliver until every item passes.
4. Output pure, self-contained SVG — no external raster assets, no remote fonts. Deliver it as an actual `.svg` file, not just SVG code pasted into chat, unless the user is clearly iterating conversationally on a small tweak.

## Non-negotiables

These override any stylistic preference below them:

1. **No overlap** — text, chips, and decorative shapes never collide, at full size or shrunk to README width.
2. **No unreadable text** — everything must hold up at thumbnail scale (assume ~800px wide rendering).
3. **No fake detail** — don't invent features, numbers, or badges the repo doesn't actually have.
4. **No stock-art clutter** — one dominant focal idea; supporting elements stay subordinate.
5. **Repo-specific identity** — a generic "AI startup banner" that could belong to any repo is a failure state, even if it's pretty.

## Quick style defaults

- Dark or project-aligned background, limited palette (one primary accent + one supporting accent), strong contrast.
- Monospace for anything code-flavored (CLI tools, technical labels); geometric sans for the title otherwise.
- One short title, at most one subtitle line — represent extra facts as compact chips/badges, never paragraphs.
- Standard aspect ratio for README headers is wide, e.g. `viewBox="0 0 1280 640"` (2:1) or `viewBox="0 0 1280 400"` (3.2:1) for a slimmer banner — pick based on how much a GitHub README banner typically needs to show. `references/svg_rules.md` has the full sizing table.

## Reference files

- `references/concepts.md` — the 4 standard concept families, when each fits a repo type, and their tradeoffs. Read during Pass 2.
- `references/svg_rules.md` — concrete SVG construction rules: exact viewBox options, spacing units, contrast minimums, type scale, how to structure `<g>` layers. Read during Pass 3, before writing markup.
- `references/checklist.md` — final QA gate. Run through this immediately before delivering.
- `assets/hero_template.svg` — a working, repo-agnostic scaffold with grid, groups, and placeholder text already positioned correctly. Start here instead of a blank canvas.
- `scripts/repo_signals.py` — structured repo inspection helper for Pass 1.
- `demos/` — three complete example heroes (architecture, terminal, geometric) generated with this skill for this repo. Skim them during Pass 2 to calibrate density and composition.

## Do not

- Do not render a final SVG before the user has seen and chosen from the Pass 2 options (unless they explicitly ask you to just pick one).
- Do not reuse the `algorithmic-art` or `canvas-design` skills' workflow for this task, even if both are available — those produce abstract generative/design-philosophy art with a deliberately hidden conceptual reference, which is the opposite of what a README hero needs: literal, legible, fact-grounded identity. If the user wants abstract generative art or a museum-style poster instead of a repo banner, point them at those skills rather than blending approaches here.
- Do not invent project facts, metrics, or capabilities not present in the repo or the user's description.
- Do not ship raster images, outlined/converted text (unless requested), or remote font/asset dependencies.
