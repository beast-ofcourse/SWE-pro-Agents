# Backend focus

Server-side logic, services, background jobs, data access, and integrations.

## What to check before writing

- **The actual contract.** For an endpoint or service method, confirm request/response shape, status codes, and error format against what already exists elsewhere in the API — don't invent a new convention for one endpoint.
- **Data access patterns already in use.** Is there an ORM, a query builder, raw SQL? Match it. If you're adding a query, check for an existing similar one first — duplicating query logic that could be shared is exactly the kind of thing Reviewer will flag.
- **Transaction and concurrency boundaries.** If the change touches anything that mutates shared state, think about what happens under concurrent access or partial failure, not just the single-request happy path.
- **Auth and validation.** Where does input get validated, and where does auth get checked, in this codebase? Put new logic in the same place — don't scatter ad hoc checks.

## Common failure modes to avoid

- Adding a new error-handling style that doesn't match how the rest of the service reports failures (custom exception vs. return codes vs. Result types — use whichever this codebase already committed to).
- Forgetting idempotency for anything that might be retried (webhooks, background jobs, payment-adjacent code).
- Silently swallowing an error instead of propagating or logging it the way the rest of the codebase does.
- Hardcoding a value that should come from config/environment, especially secrets, URLs, or feature flags.

## Before moving on

Can you state, in one sentence, what happens when this endpoint/job/service call fails partway through? If you can't answer that, the error handling isn't done yet.
