# SVG Hero Best Practices

## Composition
- Use one dominant focal area.
- Keep all supporting elements subordinate.
- Allow at least one full padding unit around the edges.
- Check the design at small README width.

## Typography
- Use short title text.
- Prefer one subtitle line only.
- Use consistent line heights and anchors.
- Keep code-like labels monospaced if the project feels technical.

## Alignment
- Snap major elements to an implied grid.
- Align labels to common baselines.
- Avoid manual offsets that fight the layout system.
- Re-check bounds before finalizing.

## Color
- Limit the palette.
- Use one primary accent and one supporting accent.
- Preserve strong contrast.
- Use status colors only when they have meaning.

## SVG implementation
- Keep `viewBox` explicit.
- Use grouped layers (`<g>`) for structure.
- Keep text as editable text.
- Use vector primitives instead of embedded bitmaps.
- Prefer deterministic coordinates over random spacing.

## GitHub README concerns
- Ensure the image still reads at thumbnail size.
- Avoid overly tall banners.
- Make the hero understandable even if the README is scanned quickly.
- Keep file size reasonable.
