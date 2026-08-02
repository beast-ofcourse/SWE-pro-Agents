# SVG Construction Rules

Concrete numbers and structure for Pass 3 (rendering). Read this after a concept direction is chosen, before writing markup. Pair with `assets/hero_template.svg` as your starting scaffold.

## Canvas size

Pick one, based on where the image will be used:

| Use case | viewBox | Aspect | Notes |
|---|---|---|---|
| Standard README top banner | `0 0 1280 640` | 2:1 | Safe default when unsure |
| Slim README header | `0 0 1280 400` | 3.2:1 | Good for text-forward/editorial directions |
| GitHub social preview | `0 0 1280 640` | 2:1 | GitHub crops social previews to 2:1; keep key content in the center-safe 1200x600 area |
| Wide hero / docs site banner | `0 0 1600 500` | 3.2:1 | Only if the target isn't GitHub's own README rendering width |

Keep the `viewBox` explicit and never rely on implicit sizing. Do not mix units — pick one coordinate system (matching the viewBox) and stay in it throughout.

## Grid and spacing

- Use an 8px base unit for all spacing decisions (padding, gaps, offsets). Multiples of 8 (8, 16, 24, 32, 48, 64) keep alignment feeling intentional rather than arbitrary.
- Minimum padding from any canvas edge to the nearest element: 40px on a 1280-wide canvas (scale proportionally for other widths).
- When placing multiple chips/badges in a row, use a consistent gap (16 or 24px) and consistent vertical centering — do not eyeball offsets per-chip.
- Snap major elements (title baseline, subtitle baseline, chip row) to a small number of horizontal guide lines rather than free-floating each one.

## Typography

- Title: one line, large, high-contrast. Target 48–72px for a 1280-wide canvas depending on title length — longer titles need a smaller size, not a cramped layout.
- Subtitle (optional, at most one line): 20–28px, lower-contrast color than the title but still comfortably readable, never below a 4.5:1 contrast ratio against the background.
- Chips/labels/badges: 13–16px, monospace if the project is technical, geometric sans otherwise.
- Never scale text via a `transform` — set the actual `font-size`. Keep text as real `<text>` elements, not outlined paths, unless the user explicitly asks for outlined/converted text (e.g. for a custom display font not available as a web font).
- Set `text-anchor` deliberately (`start`, `middle`, `end`) and be consistent about which anchor a given column of text uses — don't mix anchors within the same visual column.

## Contrast and color

- Maintain at least 4.5:1 contrast between title text and its background; 3:1 is the absolute floor for large decorative text only.
- Limit the palette to background + one primary accent + one supporting accent. A third accent is acceptable only for a status/semantic color (e.g. a "passing" green chip) that carries real meaning — never purely decorative.
- Don't rely on color alone to distinguish chips or categories if the difference matters; pair color with a label or shape difference too.

## Structure

- Wrap each logical section in its own `<g>` with a clear `id` (e.g. `id="title-group"`, `id="fact-chips"`, `id="bg-pattern"`). This keeps the file editable and makes later tweaks (by you or the user) safe and localized.
- Prefer deterministic coordinates (explicit x/y per element) over anything that reads as randomly placed. If a background pattern needs repetition, generate it with a tight loop of predictable offsets, not scattered noise — this is a factual banner, not generative art, so apparent randomness undermines the "designed" feel.
- Avoid embedded raster images (`<image>` with base64 data) unless the user explicitly supplies a logo/asset to embed. If they do supply one, keep the embed as small and optimized as reasonably possible.
- Do not import remote fonts (`@import`, `<link>`, Google Fonts, etc.) — GitHub strips or blocks many of these in rendered READMEs. Stick to common system/web-safe font-family stacks (e.g. `ui-monospace, "SF Mono", Consolas, monospace` or `-apple-system, "Segoe UI", sans-serif`) so the banner renders consistently without external dependencies.

## Sanity checks while building

- After placing the title and subtitle, mentally (or actually) shrink the canvas to ~800px wide — is the title still comfortably legible? README images render small in practice.
- Count distinct visual "facts" on the banner. More than ~5–6 discrete pieces of information (title, subtitle, 3-4 chips) usually means the banner is doing too much — cut, don't shrink further.
- Check every text element's bounding box against its neighbors — two elements can each look fine in isolation and still collide once placed together.
