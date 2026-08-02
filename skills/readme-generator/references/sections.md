# README Section Playbook

Do not use every section automatically. Select sections based on repository evidence and audience.

## Header / Hero
Include:
- project name
- one-line value proposition
- verified badges only when useful
- optional verified demo/image

Avoid:
- generic marketing slogans
- badge walls
- claims such as "production-ready" without evidence

## Why / Overview
Answer what the project is, the problem it solves, and who it is for. Keep it short.

## Demo
Use one of:
- live demo link
- screenshot
- GIF
- short terminal session
- minimal usage example

Only reference assets that actually exist.

## Features
Prefer 3–8 high-value capabilities. Describe behavior, not implementation trivia.

## Architecture / How It Works
Use when architecture materially helps understanding. A small diagram or 3–6 step flow is better than a source dump.

## Requirements
List only requirements proven by manifests, CI, docs, containers, or source constraints.

## Installation
Give the shortest verified setup path. Include prerequisites before commands.

## Quick Start
Show the first useful action after installation.

## Usage
Adapt to project type:
- library: import + primary API
- CLI: common command + arguments
- web app: start + URL + first action
- service: start + request example
- agent: invocation + configuration + expected behavior

## Configuration
Document meaningful environment variables, config files, flags, defaults, and required setup. Never include secret values.

## API / CLI Reference
Use a compact table or examples for the most important surface. Link to deeper docs if the reference becomes large.

## Development
Document the real local workflow: install, dev server, build, format, lint, generated artifacts, and any required services.

## Testing
Give the exact verified test command(s), test scope if obvious, and any required setup.

## Project Structure
Use when the repository is large enough that a tree materially helps orientation. Keep it curated.

## Roadmap
Only include if a roadmap exists in issues/docs/project files or the user explicitly provides one. Do not invent future work.

## Contributing
Link to `CONTRIBUTING.md` if present. Otherwise give the smallest accurate contribution workflow.

## Security
If `SECURITY.md` exists, link to it. Otherwise mention security reporting only if a reliable process is established.

## License
State the actual license and link to the repository file where possible.

## Acknowledgments / Credits
Use only for meaningful dependencies, upstream projects, research, authors, or inspiration that the repository actually credits.

## Documentation links
Link to detailed guides, API references, architecture docs, examples, changelog, and contribution docs when they exist. Prefer relative paths for files in the same repository.
