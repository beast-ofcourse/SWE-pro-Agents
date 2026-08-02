---
name: svg-hero-generator
description: "Generate minimalist, repo-aware SVG hero images for README files. Use when a user wants a README banner/hero image, wants SVG source rather than a raster image, or wants multiple style directions before picking one."
license: MIT
compatibility: opencode
---

# SVG Hero Image Generator

This skill creates **editable SVG hero images for READMEs**. It is designed to be repository-aware, concept-driven, and conservative: the agent first studies the repository, then proposes **3–4 distinct SVG directions**, and only renders the final SVG after the user chooses one.

## Core Goal

Make a hero image that feels native to the repository:
- visually consistent with the project identity
- readable at README scale
- simple enough to remain elegant when shrunk
- editable as SVG source
- safe to embed in GitHub README files

## Operating Contract

### First pass: inspect the repository
Before drawing anything, inspect the repo for:
- README and existing visual language
- project type and primary stack
- package metadata or build configuration
- brand assets, logos, icons, screenshots, or diagram files
- terminology that should appear in the banner
- the project’s tone: experimental, professional, playful, academic, hacker-like, enterprise, etc.

Useful signals include:
- `README.md`
- `package.json`, `pnpm-lock.yaml`, `yarn.lock`
- `pyproject.toml`, `requirements.txt`, `setup.py`
- `go.mod`, `Cargo.toml`, `pom.xml`, `gradle.*`
- `docker-compose.*`, `Dockerfile`, `.github/workflows/*`
- `/docs`, `/assets`, `/public`, `/images`, `/static`

### Second pass: synthesize concepts
Do **not** immediately render a final image.

Instead, infer the best 3–4 directions and present them as options. Each option should include:
- a short name
- the visual idea
- why it fits this repo
- composition notes
- risk/tradeoff notes

The options should be meaningfully different. Example directions:
- minimalist terminal banner
- abstract architecture diagram
- editorial headline card
- geometric logo/grid composition

### Third pass: wait for selection
Do not generate the final SVG until the user picks one option or explicitly asks you to choose.

If the user asks for a surprise choice, pick the strongest repo-fit direction and say why.

## SVG Generation Rules

### Default style
Prefer:
- a dark, neutral, or project-aligned background
- a strict grid
- a limited palette
- thin lines and clear spacing
- monospace or geometric sans typography
- highly legible small text
- a single focal structure

### Absolute priorities
1. **No overlap**
2. **No unreadable text**
3. **No fake detail**
4. **No clutter**
5. **Repo-specific identity**

### Use SVG source, not raster art
Deliver:
- pure SVG code
- one self-contained `<svg>` document
- no external raster dependency
- minimal or no remote assets
- optional gradients only if they improve clarity

### Layout quality rules
- Use `viewBox` deliberately and keep a stable aspect ratio
- Align text with consistent baselines and anchors
- Use groups (`<g>`) to manage sections
- Avoid placing labels near lines or borders
- Keep generous padding around edges
- Prefer fewer elements with stronger hierarchy
- Do not force too much information into a single banner

### Text rules
- Keep the main title short
- Use at most one strong subtitle line
- Avoid tiny explanatory paragraphs inside the hero image
- If multiple repo facts matter, represent them as compact chips, badges, or nodes
- Never allow long labels to collide or wrap badly

### Accessibility rules
- Maintain strong contrast between foreground and background
- Make sure text remains readable at README thumbnail size
- Avoid color-only meaning when possible
- Ensure decorative elements do not compete with the title

## Repository-Aware Concept Heuristics

### If the repo is a CLI / terminal tool
Bias toward:
- terminal window framing
- command prompt motif
- compact status chips
- process/pipeline language

### If the repo is an AI / agent / orchestration project
Bias toward:
- nodes, edges, pipelines, or layered stacks
- orchestration center with peripheral capabilities
- subtle command line or console cues
- modular, systems-style composition

### If the repo is a library / package
Bias toward:
- clean title cards
- minimal diagrams
- feature chips
- version / runtime / compatibility cues

### If the repo is a web app
Bias toward:
- layout blocks, browser-frame composition, or product-card style
- concise product value statement
- understated UI motifs

### If the repo is a design / creative repo
Bias toward:
- editorial composition
- restrained typography
- strong whitespace
- visual identity over technical density

## Output Format When Presenting Options

When asking the user to choose, show each option with:
- name
- 1-line summary
- 2–3 visual traits
- one reason it is appropriate
- one risk it avoids

Keep the options short, distinct, and actionable.

## Final SVG Delivery Standard

When the user selects an option:
- generate the final SVG source
- keep the composition polished and minimal
- ensure every element is aligned
- avoid overlap even under constrained scaling
- keep the code readable and editable
- include a short note on how to use or tweak the SVG if helpful

## Quality Gate Before Delivery

Do not deliver the SVG until all of these are true:
- title is legible
- spacing is consistent
- elements are visually centered or intentionally asymmetrical
- no text collisions
- no clipped content
- design clearly matches the repository’s tone
- the image still works at README width

## Best Practices

### Design best practices
- Use one visual idea, not five
- Prefer hierarchy over decoration
- Keep the banner recognizable in one glance
- Let the repository content shape the image
- Do not over-explain inside the banner
- Leave room for the README around the image

### Engineering best practices
- Keep the SVG self-contained
- Keep text editable as text, not outlines, unless requested
- Use semantic IDs and grouped structure
- Prefer deterministic placement values
- Avoid fragile external fonts or assets
- Validate rendering mentally at both full size and thumbnail size

### Working style best practices
- Be honest about uncertainty
- If the repository is sparse, say so and choose the safest minimal direction
- If the project is highly technical, reflect that in the composition
- If multiple directions are plausible, present the best 3–4 instead of guessing silently

## Do Not
- Do not generate a final SVG before showing options
- Do not overload the composition with paragraphs
- Do not use generic stock-style art
- Do not invent project facts
- Do not use unreadable microscopic labels
- Do not let labels overlap
- Do not use a style that ignores the repo’s identity
