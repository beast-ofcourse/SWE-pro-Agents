# Final QA Checklist

Run through this immediately before delivering the SVG. Don't deliver until every line is true.

- [ ] Title is spelled correctly and matches the actual project name
- [ ] No two text/chip elements overlap or collide, including at ~800px shrink
- [ ] No element is clipped by the viewBox edges
- [ ] Left/right spacing is balanced (or intentionally, legibly asymmetrical — not accidental)
- [ ] Title-to-background contrast is at least 4.5:1
- [ ] Every fact shown (chip, label, stat) is real and traceable to the repo or the user's own description — nothing invented
- [ ] Decorative elements stay subordinate to the title; nothing competes with it for attention
- [ ] Color palette is limited (background + primary accent + supporting accent, plus semantic color only if meaningful)
- [ ] The file is valid, self-contained SVG — no external raster assets, no remote font imports
- [ ] Text is real `<text>` (editable), not outlined paths, unless outlining was explicitly requested
