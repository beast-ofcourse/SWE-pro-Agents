---
name: flowchart-html
description: Use this skill to create beautiful, professional flowcharts, process diagrams, decision trees, org charts, or workflow diagrams as a single self-contained HTML file with a large canvas. Trigger this whenever the user asks for a "flowchart", "process diagram", "workflow diagram", "decision tree", "org chart", or wants to visualize steps/logic/a process — whether for technical documentation, software/system workflows, business presentations, or general process mapping. Also trigger if the user asks to visualize any sequential, branching, or hierarchical process as a diagram, even if they don't say the word "flowchart" explicitly (e.g. "show the steps for X and where it branches", "diagram how this decision gets made"). Produces a polished single-file .html deliverable — not Mermaid code, not an image.
license: MIT
compatibility: opencode
---

# Flowchart HTML Generator

Creates professional, visually polished flowcharts as a single self-contained `.html` file, rendered on a large SVG canvas. Built for cases where the user wants something that looks designed — not a default Mermaid diagram — and that they can open in any browser, share as one file, or embed elsewhere.

## Why single-file SVG instead of Mermaid

Mermaid is great for quick technical diagrams, but its default styling rarely looks "professional" or "beautiful" without heavy CSS overrides, and its auto-layout can produce cramped or awkward spacing on complex flows. For a deliverable the user explicitly wants to look good, hand-built SVG inside one HTML file gives full control over spacing, alignment, typography, color, and shape — while still being simple text/code that's easy to generate, edit, and reason about. It also works completely offline with zero dependencies once created.

Use Mermaid instead only if the user explicitly asks for Mermaid syntax/code rather than a finished visual file.

## Before building: ask 3 things (unless already specified)

Don't guess silently on these — they change the output significantly. If the user's request already answers one (e.g. "make it interactive" or "keep it minimal"), don't re-ask that one; only ask what's still unclear. Use `ask_user_input_v0` if available, otherwise ask inline in a short message.

1. **Purpose/content type** — technical process, business presentation, decision tree, org chart, or general. This affects tone: technical flows favor rectangles and clear conditional branches; business presentations favor more whitespace and softer visual weight; org charts favor a top-down tree instead of a linear flow.
2. **Static vs. interactive** — a clean static diagram (best for exporting, printing, embedding in docs/slides) vs. an interactive one with zoom/pan and possibly draggable nodes (best for exploring large or complex flows on screen). If the user has no preference, auto-pick based on complexity: **under ~15 nodes → static**, **15+ nodes or multiple swimlanes → interactive** (zoom/pan at minimum), and briefly tell the user which you picked and why.
3. **Visual style** — modern/minimal, corporate/professional, or bold/colorful. If the user has no preference, pick based on purpose (e.g. corporate for business presentations, minimal for technical docs) and briefly state the choice so they can redirect you.

Keep this to one short message with clear options — don't turn it into a long interrogation if the user just wants to move fast.

## Canvas and layout principles

"Large canvas" means the SVG viewBox should comfortably fit the whole diagram without cramming — err on the side of more breathing room, not less. As a starting point:

- Node width: 160–220px depending on label length; node height: 60–90px
- Horizontal gap between columns/siblings: at least 60–80px
- Vertical gap between rows/levels: at least 80–100px
- Canvas padding: at least 60px on all sides beyond the outermost nodes

Compute the viewBox from actual node positions rather than hardcoding a fixed size — a 5-node flow and a 40-node flow need very different canvases. For static diagrams, the SVG should be set to scale to fit the container width (`width: 100%; height: auto`) so it looks intentional at any screen size. For interactive diagrams, set an explicit large viewBox and let pan/zoom handle the rest.

**Layout direction**: top-to-bottom for most process flows and decision trees (reads naturally, easiest to fit on screen); left-to-right for timelines or sequences where horizontal reads more naturally; strict top-down tree for org charts. Ask yourself which direction a person would naturally sketch this on paper.

**Routing connectors**: use smooth orthogonal (right-angle with rounded corners) or bezier curves — never let lines cross through nodes or overlap unreadably. If two lines must cross, keep it to a minimum and route them so the crossing is unambiguous. Label edges when the connector represents a decision/condition (e.g. "Yes" / "No" / "Approved" / "Rejected"), positioned clearly along or beside the line, not on top of it.

## Visual style guide

Pick ONE style direction and apply it consistently — inconsistent styling is what makes diagrams look unprofessional. Use `/mnt/skills/public/frontend-design/SKILL.md` for deeper typography/color guidance if you want more design grounding; the summary below is enough for most flowcharts.

**Modern/minimal**
- Palette: 1 accent color + grayscale (e.g. white/off-white nodes, dark charcoal text, one accent for start/end or emphasis nodes)
- Shapes: rounded rectangles (8–12px radius), thin 1–1.5px borders, subtle drop shadow (blur 8-12px, low opacity) instead of heavy borders
- Typography: a clean sans-serif (system-ui, "Inter", "Helvetica Neue"), medium weight for labels, no more than 2 font sizes
- Lots of whitespace; avoid filling the canvas edge to edge

**Corporate/professional**
- Palette: muted blues/grays/greens, one clear color per node "type" (e.g. blue = process, amber = decision, green = success/end, red = stop/error) — keep a legend if there are 3+ types
- Shapes: rectangles for process steps, diamonds for decisions, stadium/pill shapes for start/end, consistent corner radius across all rectangles
- Typography: professional sans-serif, consistent sizing, high contrast text for readability at a glance (this will likely be presented or projected)
- Structured, evenly-spaced grid alignment — nodes in the same "stage" should align on the same row/column

**Bold/colorful**
- Palette: 3–5 vibrant but harmonious colors (check they still have good text contrast — don't sacrifice readability for boldness), can use gradients tastefully on key nodes
- Shapes: can be more playful (larger rounded corners, thicker borders/outlines) but keep shape *meaning* consistent (same shape = same node type)
- Typography: can be a bit bolder/larger, but keep body label text still easily readable — boldness lives in color and shape, not illegible fonts

Across all styles: pick 2–4 distinct shapes maximum and use them consistently for node *types* (e.g. rounded rect = process, diamond = decision, pill = start/end, hexagon = input/output). Never use a shape inconsistently — that's the fastest way for a diagram to look amateurish.

## Building the file

1. Plan the diagram structure first as a simple list/outline in your reasoning: nodes, their type (process/decision/start/end), and edges (with labels if conditional) — before writing any SVG. This avoids re-layout churn.
2. Compute a grid or tree layout by hand: assign each node an (x, y) based on its level/column and position within that level, keeping the spacing rules above. For anything beyond ~10 nodes, do this arithmetic explicitly (e.g. in a short script or scratch calculation) rather than eyeballing coordinates — misaligned nodes are the most common flaw in generated flowcharts.
3. Write the SVG nodes and connectors using the computed coordinates.
4. Wrap in a single HTML file: inline `<style>` for all CSS, inline `<script>` for any interactivity, and no external dependencies. Use system fonts by default; embed any custom font locally if its license permits — never link an external font (e.g. Google Fonts) that makes the file network-dependent or triggers a third-party request when opened.
5. If interactive: implement pan and zoom with pointer input and keyboard-accessible, focusable controls (e.g. `+`/`-` buttons and arrow-key panning), and keep it simple — don't over-engineer. Vanilla JS with SVG `viewBox` manipulation is sufficient; no need for a charting library for this.
6. Sanity-check before delivering: does every edge connect to an actual node (no dangling lines)? Do any nodes/text overflow their shape? Do any lines cross through node boxes? Is text legible at default zoom? Can a keyboard-only user focus and operate the pan/zoom controls?

## Output

Save as a single `.html` file to `/mnt/user-data/outputs/` and share it with `present_files` if that tool is available. If `present_files` is not available (it is not present in every OpenCode environment), save the file in the workspace or a path you give the user and tell them exactly where it is so they can open the generated `.html` themselves. Use a descriptive filename based on the diagram's subject (e.g. `user-onboarding-flowchart.html`, not `flowchart.html`) so it's identifiable if the user requests multiple.
