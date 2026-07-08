<!--
TEMPLATE: docs/tasks.md
Owned by: planner subagent, status kept live by orchestrator during
execution. This is THE living backlog — never delete a task, never
renumber, always attach evidence before marking done. Delete this comment
block in the real file.

STATUS LEGEND: pending | in-progress | blocked | needs-review | done
-->

# Tasks: <Project Name>

**Last updated:** <date>
**Summary:** <N> total | <N> done | <N> in-progress | <N> blocked | <N> pending

---

## Phase 0 — Understand the Goal

<Usually no implementation tasks here — this phase produces
project-overview.md's opening sections. Include a checkpoint task if useful.>

---

## Phase 1 — Deep Research

### TASK-001: Conduct initial research pass
- Phase: 1
- Status: pending
- Owner: researcher
- Requirement refs: n/a (pre-requirements)
- Goal: Produce docs/research.md covering competitors, OSS prior art,
  architecture patterns, libraries, security/perf/a11y considerations,
  and deployment options.
- Dependencies: none
- Implementation steps:
  1. Research per the researcher agent's standing brief
  2. Write docs/research.md
- Acceptance criteria:
  - [ ] All standing topics covered with real citations
  - [ ] Recommendations section gives a clear steer
- Tests required: n/a
- Quality checks: n/a
- Performance checks: n/a — research task, not implementation
- Security checks: n/a — research task, not implementation
- Documentation required: docs/research.md itself is the deliverable
- Last updated: <date>

---

## Phase 2 — Requirements Engineering

### TASK-002: Draft requirements.md from research
- Phase: 2
- Status: pending
- Owner: planner
- Requirement refs: n/a (this task produces the requirement IDs)
- Goal: Convert research + goal statement into numbered FR/NFR/UXR/SEC/
  PERF/SCALE/MAINT requirements.
- Dependencies: [TASK-001]
- Implementation steps:
  1. Draft docs/requirements.md
  2. Cross-check every requirement is testable/verifiable
- Acceptance criteria:
  - [ ] Every requirement has a unique ID
  - [ ] NFR/PERF targets have actual numbers, not vague adjectives
- Tests required: n/a
- Quality checks: n/a
- Performance checks: n/a
- Security checks: n/a
- Documentation required: docs/requirements.md itself
- Last updated: <date>

---

## Phase 3 — Architecture

### TASK-003: Design and document architecture
- Phase: 3
- Status: pending
- Owner: planner
- Requirement refs: <all, since architecture must satisfy all of them>
- Goal: Produce docs/architecture.md with stack, structure, libraries, DB,
  auth, deployment, state/data-flow, and testing strategy.
- Dependencies: [TASK-002]
- Implementation steps:
  1. Draft docs/architecture.md
  2. Verify every requirement has an architectural answer
- Acceptance criteria:
  - [ ] Every FR/NFR/SEC/PERF/SCALE requirement is addressed by some
        part of the architecture
  - [ ] Folder structure is concrete, not vague
- Tests required: n/a
- Quality checks: n/a
- Performance checks: n/a
- Security checks: n/a
- Documentation required: docs/architecture.md itself
- Last updated: <date>

---

## Phase 4 — Project Overview Finalization

### TASK-004: Finalize project-overview.md
- Phase: 4
- Status: pending
- Owner: orchestrator
- Requirement refs: n/a
- Goal: Complete all sections of project-overview.md (personas, scope,
  flows, features mapped to FR IDs, constraints, design philosophy).
- Dependencies: [TASK-002, TASK-003]
- Implementation steps:
  1. Fill remaining sections
  2. Cross-link features to FR IDs
- Acceptance criteria:
  - [ ] Every section in the template is filled, not left as placeholder
- Tests required: n/a
- Quality checks: n/a
- Performance checks: n/a
- Security checks: n/a
- Documentation required: project-overview.md itself
- Last updated: <date>

---

## Phase 5+ — Implementation

<Real implementation tasks go here, one per TASK-ID, following the full
schema below. This is illustrative — replace with actual project tasks.>

### TASK-005: <Example: "Implement user registration endpoint">
- Phase: 5
- Status: pending
- Owner: backend
- Requirement refs: FR-1, SEC-1
- Goal: <one sentence, outcome-oriented>
- Dependencies: [TASK-003]
- Implementation steps:
  1. <step>
  2. <step>
- Acceptance criteria:
  - [ ] <criterion>
- Tests required:
  - [ ] unit: <what>
  - [ ] integration: <what>
- Quality checks: lint, typecheck, format
- Performance checks: n/a — justify why, or name the specific check
- Security checks: password hashing verified, input validation verified
- Documentation required: API doc entry for this endpoint
- Blocked reason: <only if status=blocked>
- Evidence of completion: <only once done — links to test output, commit
  hash, reviewer verdict>
- Discovered from: <only if spawned by another task>
- Last updated: <date>

---

## Discovered / Follow-up Tasks

<New tasks discovered mid-execution get appended here if they don't
cleanly belong to a phase above yet, or directly into the relevant phase
section — either is fine as long as the "Discovered from" field links
back to the originating task.>
