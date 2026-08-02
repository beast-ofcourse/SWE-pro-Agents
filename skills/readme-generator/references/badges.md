# Badge Policy

Badges are evidence, not decoration.

## Recommended order
Usually:
1. CI/build status
2. package/release version
3. license
4. coverage (only if an actual coverage workflow/report exists)
5. package/download metadata (only when meaningful)

## Rules
- Use only badges whose underlying source exists and is current.
- Never invent workflow filenames, release tags, package names, owners, or repository paths.
- Do not add stars, forks, downloads, or social badges merely for vanity.
- If a badge is not useful to the intended reader, omit it.
- Keep the badge row short.

## Common Shields patterns

```markdown
![License](https://img.shields.io/github/license/OWNER/REPO)
![Release](https://img.shields.io/github/v/release/OWNER/REPO)
![CI](https://img.shields.io/github/actions/workflow/status/OWNER/REPO/WORKFLOW.yml)
```

Replace every placeholder only after verifying the actual repository and workflow names.

## Badge validation
Before output:
- repository owner/name is verified
- workflow filename is verified
- package/release actually exists when claimed
- license exists
- URL is syntactically valid
