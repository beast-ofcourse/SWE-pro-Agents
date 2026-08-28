#!/usr/bin/env python3
"""Generate a deterministic, compact repository tree for README work."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

DEFAULT_EXCLUDES = {
    ".git", ".hg", ".svn", "node_modules", "__pycache__", ".venv", "venv",
    "env", ".tox", ".mypy_cache", ".pytest_cache", ".ruff_cache", ".cache",
    "dist", "build", "coverage", ".next", ".nuxt", "target", "vendor",
}


def tree(root: Path, max_depth: int, excludes: set[str]) -> str:
    root = root.resolve()
    lines: list[str] = [f"{root.name}/"]

    def walk(path: Path, prefix: str, depth: int) -> None:
        if depth >= max_depth:
            return
        try:
            entries = sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
        except OSError:
            return

        entries = [e for e in entries if e.name not in excludes and not e.name.startswith(".DS_Store")]
        for i, entry in enumerate(entries):
            last = i == len(entries) - 1
            branch = "└── " if last else "├── "
            suffix = "/" if entry.is_dir() else ""
            lines.append(f"{prefix}{branch}{entry.name}{suffix}")
            if entry.is_dir():
                walk(entry, prefix + ("    " if last else "│   "), depth + 1)

    walk(root, "", 0)
    return "\n".join(lines)


if __name__ == "__main__":
    # Windows consoles default to legacy encodings (e.g. cp1252) that cannot
    # represent the box-drawing characters below — force UTF-8 output.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Generate a clean repository tree.")
    parser.add_argument("path", nargs="?", default=".")
    parser.add_argument("--depth", type=int, default=3)
    parser.add_argument("--exclude", action="append", default=[])
    args = parser.parse_args()
    print(tree(Path(args.path), args.depth, DEFAULT_EXCLUDES | set(args.exclude)))
