<!--
TEMPLATE: docs/requirements.md
Owned by: planner subagent (Phase 2)
Every requirement gets a stable, never-reused ID. Once TASK entries in
tasks.md reference an ID, don't renumber it even if requirements are later
split, removed, or superseded — mark status inline instead.
Delete this comment block in the real file.
-->

# Requirements: <Project Name>

**Last updated:** <date>
**Derived from:** docs/research.md, docs/project-overview.md (Goal
Statement + Success Criteria)

## Functional Requirements

| ID | Requirement | Status | Notes |
|---|---|---|---|
| FR-1 | <Concrete, verifiable system behavior> | active | |
| FR-2 | | active | |

## Non-Functional Requirements

| ID | Requirement | Target | Status |
|---|---|---|---|
| NFR-1 | <e.g. Availability> | <e.g. 99.5% uptime> | active |
| NFR-2 | | | active |

## UX Requirements

| ID | Requirement | Notes |
|---|---|---|
| UXR-1 | <e.g. All flows completable via keyboard alone> | Accessibility target: WCAG 2.1 AA |
| UXR-2 | | |

## Security Requirements

| ID | Requirement | Notes |
|---|---|---|
| SEC-1 | <e.g. Passwords hashed with argon2id> | |
| SEC-2 | <e.g. Authorization checked on every resource access, not just authentication> | |

## Performance Requirements

| ID | Requirement | Target |
|---|---|---|
| PERF-1 | <e.g. API response time> | <e.g. p95 < 300ms at 100 concurrent users> |
| PERF-2 | | |

## Scalability Requirements

| ID | Requirement | Assumption |
|---|---|---|
| SCALE-1 | <e.g. Expected initial load> | <e.g. up to 1,000 daily active users> |

## Maintainability Requirements

| ID | Requirement | Target |
|---|---|---|
| MAINT-1 | Test coverage | <e.g. ≥ 80% on business logic> |
| MAINT-2 | Lint/typecheck gate | Must pass with zero errors before merge |
| MAINT-3 | Documentation | Every public API endpoint documented |

---

## Traceability Note

Every task in `docs/tasks.md` should reference at least one requirement ID
from this file via its "Requirement refs" field. Every requirement here
should eventually be traceable to at least one task and, ultimately, at
least one test. If a requirement has no task working toward it, that's a
planning gap worth surfacing.

## Revision Log

| Date | Change | Reason |
|---|---|---|
| <date> | Initial requirements drafted from research | Phase 2 |
