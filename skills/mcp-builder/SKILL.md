---
name: mcp-builder
description: Guide for creating high-quality MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. Use when building MCP servers to integrate external APIs or services, whether in Python (FastMCP) or Node/TypeScript (MCP SDK). Also use when adding MCP servers to an OpenCode or Claude Code config, or when reviewing an existing MCP server for tool-design quality.
license: MIT
compatibility: opencode
---

# MCP Server Development Guide

Create MCP (Model Context Protocol) servers that enable LLMs to interact with external services through well-designed tools. The quality of an MCP server is measured by how well it enables LLMs to accomplish real-world tasks.

> Adapted from Anthropic's `mcp-builder` skill (MIT). This version is self-contained: fetch the live protocol and SDK docs during the build instead of relying on bundled reference files.

---

# Process

## Phase 1: Deep Research and Planning

### 1.1 Understand Modern MCP Design

**API Coverage vs. Workflow Tools:**
Balance comprehensive API endpoint coverage with specialized workflow tools. Workflow tools can be more convenient for specific tasks, while comprehensive coverage gives agents flexibility to compose operations. Performance varies by client — some clients benefit from code execution that combines basic tools, while others work better with higher-level workflows. When uncertain, prioritize comprehensive API coverage.

**Tool Naming and Discoverability:**
Clear, descriptive tool names help agents find the right tools quickly. Use consistent prefixes (e.g., `github_create_issue`, `github_list_repos`) and action-oriented naming.

**Context Management:**
Agents benefit from concise tool descriptions and the ability to filter/paginate results. Design tools that return focused, relevant data.

**Actionable Error Messages:**
Error messages should guide agents toward solutions with specific suggestions and next steps — never bare status codes.

### 1.2 Study the MCP Protocol Documentation

- Start with the sitemap: `https://modelcontextprotocol.io/sitemap.xml`
- Fetch specific pages with `.md` suffix for markdown (e.g., `https://modelcontextprotocol.io/specification/draft.md`)
- Key pages: specification overview and architecture, transport mechanisms (streamable HTTP, stdio), tool/resource/prompt definitions

### 1.3 Choose the Stack

**Recommended:**
- **Language:** TypeScript — high-quality SDK support, static typing, good linting, and models generate it well
- **Transport:** streamable HTTP for remote servers (stateless JSON — simpler to scale and maintain); stdio for local servers

**Load framework docs during this phase:**
- TypeScript SDK: `https://raw.githubusercontent.com/modelcontextprotocol/typescript-sdk/main/README.md`
- Python SDK: `https://raw.githubusercontent.com/modelcontextprotocol/python-sdk/main/README.md`
- MCP best practices: `https://modelcontextprotocol.io/docs/best-practices` (or the `.md` variant)

### 1.4 Plan the Implementation

- **Understand the API:** review the service's API docs — endpoints, authentication, data models. Use web search and WebFetch as needed
- **Tool selection:** list endpoints to implement, starting with the most common operations; prioritize comprehensive coverage

## Phase 2: Implementation

### 2.1 Set Up the Project

- TypeScript: `npm init -y`, install `@modelcontextprotocol/sdk` and `zod`, add `tsconfig.json` with strict mode
- Python: `uv init` or venv + `pip install mcp[cli]` (FastMCP), organize modules by domain

### 2.2 Implement Core Infrastructure

Create shared utilities:
- API client with authentication (never hardcode secrets — read from env)
- Error handling helpers that produce actionable messages
- Response formatting (JSON/Markdown)
- Pagination support

### 2.3 Implement Tools

For each tool:

**Input Schema:**
- Zod (TypeScript) or Pydantic (Python)
- Include constraints and clear descriptions
- Add examples in field descriptions

**Output Schema:**
- Define `outputSchema` where possible for structured data
- Use `structuredContent` in tool responses (TypeScript SDK feature)
- Helps clients understand and process tool outputs

**Tool Description:**
- Concise summary of functionality
- Parameter descriptions
- Return type schema

**Implementation:**
- Async/await for I/O operations
- Proper error handling with actionable messages
- Support pagination where applicable
- Return both text content and structured data when using modern SDKs

**Annotations:**
- `readOnlyHint`: true/false
- `destructiveHint`: true/false
- `idempotentHint`: true/false
- `openWorldHint`: true/false

## Phase 3: Review and Test

### 3.1 Code Quality

Review for:
- No duplicated code (DRY)
- Consistent error handling
- Full type coverage
- Clear tool descriptions

### 3.2 Build and Test

- **TypeScript:** run `npm run build` to verify compilation; test with MCP Inspector: `npx @modelcontextprotocol/inspector`
- **Python:** verify syntax with `python -m py_compile your_server.py`; test with MCP Inspector
- Test every tool with both valid and invalid inputs; confirm error messages are actionable

## Phase 4: Create Evaluations

Evaluations test whether LLMs can effectively use your MCP server to answer realistic, complex questions.

### 4.1 Create 10 Evaluation Questions

1. **Tool inspection:** list available tools and understand their capabilities
2. **Content exploration:** use READ-ONLY operations to explore available data
3. **Question generation:** create 10 complex, realistic questions
4. **Answer verification:** solve each question yourself to verify the answers

### 4.2 Evaluation Requirements

Each question must be:
- **Independent** — not dependent on other questions
- **Read-only** — only non-destructive operations required
- **Complex** — requiring multiple tool calls and deep exploration
- **Realistic** — based on real use cases humans would care about
- **Verifiable** — single, clear answer that can be verified by string comparison
- **Stable** — the answer won't change over time

### 4.3 Output Format

```xml
<evaluation>
  <qa_pair>
    <question>Find discussions about AI model launches with animal codenames. One model needed a specific safety designation that uses the format ASL-X. What number X was being determined for the model named after a spotted wild cat?</question>
    <answer>3</answer>
  </qa_pair>
  <!-- More qa_pairs... -->
</evaluation>
```

---

# Quality Checklist

Before declaring an MCP server done:

- [ ] Tools have consistent, discoverable names with domain prefixes
- [ ] Every tool has a concise description, typed input schema, and structured output
- [ ] Errors are actionable — they tell the agent what to do next
- [ ] Pagination and filtering exist where data volumes warrant them
- [ ] Secrets come from environment variables, never source code
- [ ] `npm run build` (TS) or `py_compile` (Python) passes
- [ ] MCP Inspector session exercises every tool at least once
- [ ] 10 evaluation questions exist and all answers verified by hand
- [ ] `readOnlyHint` / `destructiveHint` annotations are accurate