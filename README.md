# SWE Pro Agents

A collection of specialized software engineering agent profiles for AI-assisted development workflows. Each agent profile defines a focused role — from implementation and debugging to architecture review and security auditing — designed for use with **OpenCode**.

## Install

```bash
npm install -g swe-pro-agents
```

This copies all 49 agent files to `~/.config/opencode/agents/swe-pro-agents/`.

Then add this to your `opencode.json`:

```json
{
  "agents": [{ "path": "~/.config/opencode/agents/swe-pro-agents" }]
}
```

**To update** when new agents are released:

```bash
npm update -g swe-pro-agents
```

### CLI

```bash
swe-pro-agents status   # Check installation status
swe-pro-agents setup    # Show config snippet
```

## Agents

The `agents/` directory contains 49 agent profiles organized into the following categories:

### SWE Agents — Specialized Engineering Roles
- **swe-api** — API endpoint design, contracts, versioning
- **swe-backend** — Server-side implementation
- **swe-cli** — Command-line tool development
- **swe-database** — Schema, migrations, queries
- **swe-debugger** — Bug reproduction and root cause analysis
- **swe-desktop** — Desktop application development
- **swe-devops** — CI/CD, containers, infrastructure
- **swe-documentation** — READMEs, docstrings, guides
- **swe-frontend** — UI components and views
- **swe-fullstack** — End-to-end feature implementation
- **swe-git** — Version control and PR management
- **swe-implementation** — General implementation work
- **swe-mobile** — Mobile application development
- **swe-opensource** — Licensing and contribution readiness
- **swe-performance** — Profiling and optimization
- **swe-planner** — Task breakdown and planning
- **swe-pro** — Senior software engineer agent
- **swe-refactor** — Code restructuring
- **swe-release** — Versioning and publishing
- **swe-repository** — Codebase exploration
- **swe-reviewer** — Code review (read-only)
- **swe-security** — Vulnerability auditing
- **swe-testing** — Unit/integration/e2e testing

### Research Agents
- **researcher** — Deep research on complex topics
- **web-researcher** — Web-based information gathering
- **report-generator** — Structured report creation

### Code Analysis Agents
- **codebase-searcher** — Fast file and pattern matching
- **context-analyzer** — Code context analysis
- **dependency-investigator** — Dependency graph analysis
- **documentation-reader** — Documentation parsing
- **evidence-verifier** — Verification of claims
- **experiment-runner** — Running experiments
- **git-history-analyst** — Git log analysis
- **issue-discussion-analyst** — Issue tracking analysis
- **repo-investigator** — Repository structure analysis

### Architecture Agents
- **architect** — System design and architecture
- **arch-api-design** — API design patterns
- **arch-architecture-review** — Architecture review
- **arch-database-design** — Database schema design
- **arch-design-patterns** — Design pattern application
- **arch-distributed-systems** — Distributed system design
- **arch-migration** — Migration planning
- **arch-rfc** — RFC authoring
- **arch-scalability** — Scalability analysis
- **arch-solution-design** — Solution design
- **arch-system-design** — System design
- **arch-tech-debt** — Technical debt assessment
- **arch-technical-strategy** — Technical strategy
- **architecture-mapper** — Architecture mapping

## Usage

These agent profiles are designed for use with AI coding assistants that support agent-based workflows. Each `.md` file contains the system prompt, instructions, and tools for a specific agent role.

## License

MIT
