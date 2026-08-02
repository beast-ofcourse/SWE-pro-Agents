# Concept Directions

The default option families for Pass 2. Use these as a starting menu, not a rigid list — if repo inspection surfaces something these four don't capture well, propose a fifth rather than forcing a fit.

## 1) Minimal Terminal Hero
Best for CLI tools, developer utilities, scripts, and agent shells.

**Look**
- dark background
- prompt line (e.g. `$ npx your-tool init`)
- compact status chips (version, license, build status)
- subtle terminal window framing

**Strength**
- instantly readable
- low clutter
- feels technical and credible

**Risk**
- can feel generic if not anchored to repo-specific terms (actual command names, actual flags) rather than a placeholder prompt

## 2) Architecture Diagram Hero
Best for AI systems, frameworks, orchestration tools, backend platforms.

**Look**
- central node representing the core system
- connected modules/peripherals with thin lines
- restrained labels naming real components from the repo

**Strength**
- communicates system structure at a glance
- works well for modular, multi-part projects

**Risk**
- becomes busy fast if more than ~5-6 nodes are added — resist the urge to show the whole architecture

## 3) Editorial Title Card
Best for polished libraries, design repos, docs-heavy projects, and clean brands.

**Look**
- oversized title
- one short subtitle
- generous whitespace
- one or two restrained accent glyphs or shapes

**Strength**
- premium and minimal
- reads well even at README thumbnail size

**Risk**
- may under-communicate for a highly technical repo where users expect to see the stack at a glance

## 4) Geometric Signal Card
Best for experimental tools, creative-coding projects, or repos with a distinctive existing visual identity.

**Look**
- grids, rings, bars, or layered panels built from deterministic (not random-looking) placement
- abstract but structured — every shape should still map to something real (a metric, a category, a status) rather than pure ornament
- short labels only

**Strength**
- visually memorable
- can look original without becoming noisy, if every shape earns its place

**Risk**
- easiest direction to accidentally turn into decoration — must stay disciplined about tying shapes to real facts, or it drifts toward the "invented detail" failure mode this skill exists to avoid
