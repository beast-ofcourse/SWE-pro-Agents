<!--
TEMPLATE: docs/architecture.md
Owned by: planner subagent (Phase 3), kept in sync throughout by planner
This is a LIVING DOCUMENT. Log every material change in the Revision Log.
Delete this comment block in the real file.
-->

# Architecture: <Project Name>

**Status:** draft | approved | living
**Last updated:** <date>

## Tech Stack

| Layer | Choice | Version | Justification |
|---|---|---|---|
| Frontend framework | | | |
| Backend framework/runtime | | | |
| Database | | | |
| ORM / query layer | | | |
| Auth | | | |
| Testing | | | |
| Deployment | | | |

## Folder Structure

```
project-root/
├── ...
```

## Key Libraries

| Library | Version | Purpose | Why this one (see research.md) |
|---|---|---|---|

## Database Schema Approach

<High-level schema design rationale. Actual schema/migrations live in
code; this section explains the *why* — normalization decisions, key
relationships, indexing strategy.>

## Authentication / Authorization

<Model chosen (session/JWT/OAuth/etc.), why, and the authorization model
(RBAC/ABAC/simple ownership checks/etc.).>

## Deployment

- **Target:** <e.g. containers on X, serverless on Y, static host + API on Z>
- **Strategy:** <CI/CD approach, environments (dev/staging/prod), rollback
  plan>

## State Management (Frontend)

<Approach and why — local state vs. global store, data-fetching/caching
library if any.>

## Data Flow (Backend)

<Request lifecycle, layering (controller/service/repository or
equivalent), how errors propagate.>

## Testing Strategy

| Type | Tool | Coverage target | What it covers |
|---|---|---|---|
| Unit | | | |
| Integration | | | |
| E2E | | | |

## API Conventions

<Status codes, error response shape, versioning approach, naming
conventions.>

---

## Revision Log

| Date | Change | Reason |
|---|---|---|
| <date> | Initial architecture drafted | Phase 3 |
