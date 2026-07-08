# Frontend focus

UI components, views, styling, client-side state, and interaction.

## What to check before writing

- **Existing component patterns.** How are components structured here — function components with hooks, class components, a specific state library? Match the existing pattern rather than introducing a second style in the same codebase.
- **State ownership.** Is this local component state, or does it belong in whatever shared state mechanism the app already uses? Don't introduce a new state pattern for one feature if the app has a established one.
- **Styling approach.** CSS modules, a utility framework, styled-components, plain CSS — use whatever's already there. Check whether design tokens or shared style variables exist before hardcoding colors, spacing, or fonts.
- **Data fetching pattern.** How does the rest of the app call the backend — a shared client, a specific hook, direct fetch calls? Match it, and match its error/loading-state handling too.

## Common failure modes to avoid

- Missing loading and error states — a component that only renders the happy path isn't finished.
- Accessibility basics: interactive elements need to be keyboard-reachable and have accessible names; images need alt text; forms need labels.
- Introducing a new dependency for something a library already in the project can do.
- Breaking existing responsive/layout behavior by not checking how the surrounding layout works before adding to it.

## Before moving on

Does this component handle: no data yet (loading), an error from the fetch, and the empty-result case (zero items), not just the populated-happy-path case? If any of those is unhandled, it's not done.
