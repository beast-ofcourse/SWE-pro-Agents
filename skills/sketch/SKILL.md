---
name: sketch
description: "Rapid throwaway HTML prototyping for UI/frontend — generate 2-3 interactive variants to compare design directions. Use when user says sketch this screen, mockup this idea, prototype a component/page, explore layout variants, compare visual approaches, or wants to see quick frontend directions before building."
version: 2.0.0
author: Hermes Agent (adapted from gsd-build/get-shit-done)
license: MIT
compatibility: opencode
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [sketch, mockup, prototype, ui, frontend, html, variants, wireframe, rapid-prototyping]
    related_skills: [spike, claude-design, popular-web-designs, excalidraw]
---

# Sketch — Rapid UI Prototyping

Create **2-3 disposable, interactive HTML variants** of a screen/component so the user can compare directions side-by-side. Speed over polish — no build step, no shippable code.

## When to use

- `sketch this`, `mockup this`, `prototype this screen/component`
- `show me what X could look like`, `explore layout options`, `compare A vs B`
- Any UI idea that needs a visual decision before building

## When NOT to use

- Production component or landing page → build it properly
- Diagram/architecture → `excalidraw` or `architecture-diagram`
- Design already locked → just implement

## Workflow

```
clarify (30s) → build 2-3 variants → verify → compare
```

### 1. Clarify — skip if already answered

Ask **one at a time**, reflect briefly, skip what you already know:

1. **Feel** — adjectives/vibe? *e.g. "calm, editorial, like Linear"*
2. **Core action** — single most important thing user does on this screen?
3. **Reference** (optional) — apps/sites that nail the feel?

If user gave all three upfront, go straight to building.

### 2. Build 2-3 variants — different stances, not different colors

Each variant is a **complete standalone HTML file**. Build them — don't describe them.

**Pick one axis and pull variants apart:**

| Axis | Contrasts |
|------|-----------|
| Density | compact vs airy |
| Emphasis | content-first vs action-first |
| Aesthetic | editorial vs utilitarian vs playful |
| Layout | single-column vs sidebar vs split-pane |
| Grounding | card-based vs bare-content |

Two variants differing only in accent color is wasted effort.

**Rules per variant:**

- Single self-contained `index.html` — inline `<style>`, no build step
- Tailwind via CDN is preferred: `<script src="https://cdn.tailwindcss.com"></script>`
- System font stack or one Google Font — keep it fast
- **Realistic fake content** — real names/sentences, never Lorem ipsum
- **Interactive** — hovers, at least one state transition (toggle, filter, modal, open/close). A static screenshot is not a sketch.

**Starter reset:**

```html
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;color:#1a1a1a;background:#fafafa;line-height:1.5}
</style>
```

**Structure:**

```
sketches/
├── 001-calm-editorial/index.html
├── 001-calm-editorial/README.md
├── 002-dense-utilitarian/index.html
└── 002-dense-utilitarian/README.md
```

Name by stance (`calm-editorial`), not number. Keep variants disposable.

### 3. Verify — look before you show

Open each file and fix visible bugs before presenting:

```
browser_navigate(url="file:///absolute/path/to/sketches/001-calm-editorial/index.html")
browser_vision(question="Any layout bugs — overlapping text, unstyled elements, broken images, collapsed flex?")
```

Re-navigate until clean.

### 4. Compare — opinionate

Present a head-to-head table and pick a winner:

```markdown
| Dimension | Calm editorial | Dense utilitarian |
|-----------|----------------|-------------------|
| Density | Low | High |
| Primary action | Subtle | Prominent |
| Scan-ability | High | Medium |
| Feel | Trusted, calm | Sharp, tool-like |

**Take:** Calm editorial for content audiences, dense utilitarian for power users.
```

Let user pick winner, merge two, or request another round.

## Variant README (minimal)

Keep each `README.md` short:

```markdown
## Variant: calm-editorial
Stance: airy, content-first, trusts whitespace.

Choices: layout single-column, Inter + system fallback, muted palette, filter toggle.
Trade-offs: strong at readability, weak at action density.
Best for: reading-heavy, first-time users.
```

## Output checklist

- [ ] `sketches/NNN-stance-name/index.html` + `README.md` per variant
- [ ] Each variant opens cleanly, interactive states work
- [ ] Comparison table with opinion
- Tell user how to open: `start sketches\001-calm-editorial\index.html` (Win) / `open` (macOS) / `xdg-open` (Linux)

## Optional extras

**Theming:** if project has tokens, add `sketches/themes/tokens.css` with 3 colors + 1 font max, `@import` in variants. Don't over-tokenize throwaways.

**What to sketch next:** if asked, propose 2-4 candidates — unsketched screens, empty/loading/error states, responsive gaps, or missing interactions.

## Attribution

Adapted from GSD `gsd-sketch` workflow — MIT © 2025 Lex Christopherson ([gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done), now archived). This standalone version is the maintained path.
