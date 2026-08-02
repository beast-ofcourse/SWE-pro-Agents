# README Validation Checklist

## Evidence
- [ ] Project purpose is supported by repository evidence.
- [ ] Every feature claim is traceable to source/docs/tests/config.
- [ ] No invented metrics, compatibility claims, roadmap items, demos, URLs, or status claims.

## Commands
- [ ] Installation commands match the actual package manager.
- [ ] Runtime/version requirements are supported.
- [ ] Run/dev commands exist in scripts/docs/config or are directly established by the project.
- [ ] Build/lint/format/test commands are real.
- [ ] Environment setup is complete enough for the documented quick start.

## Links and assets
- [ ] Local links point to existing files/directories.
- [ ] Local image/GIF paths exist.
- [ ] External URLs are syntactically valid and relevant.
- [ ] Images have useful alt text.
- [ ] Relative paths are preferred for repository-local resources.

## Markdown
- [ ] Code fences are balanced.
- [ ] Language identifiers match the code.
- [ ] Heading hierarchy is logical.
- [ ] Tables render cleanly.
- [ ] No accidental HTML or Markdown syntax leaks.
- [ ] GitHub alerts are used sparingly and correctly.

## Security
- [ ] No passwords, API keys, tokens, private keys, cookies, or credentials copied into README.
- [ ] `.env.example` is documented without exposing secret values.
- [ ] Security claims are not stronger than evidence.

## UX
- [ ] Project purpose is clear above the fold.
- [ ] First successful action is obvious.
- [ ] The README is scannable.
- [ ] Sections are proportionate to project complexity.
- [ ] No unnecessary table of contents for short READMEs.
- [ ] No badge wall or emoji spam.
- [ ] Deep details are linked rather than dumped into the root README.

## Final stranger test
A new reader should be able to answer:
- What is it?
- Why use it?
- How do I install it?
- How do I run/use it?
- What does a successful first run look like?
- Where are the deeper docs?
- How do I contribute/report security issues?

If any applicable answer is missing, improve the README before delivery.
