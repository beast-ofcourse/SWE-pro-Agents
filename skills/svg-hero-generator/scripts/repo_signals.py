#!/usr/bin/env python3
"""Lightweight repository signal extractor for SVG hero planning.

Usage:
    python repo_signals.py /path/to/repo
    python repo_signals.py . --max-depth 3
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

IMPORTANT_FILES = [
    "README.md",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "setup.py",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "docker-compose.yml",
    "docker-compose.yaml",
    "Dockerfile",
    ".github/workflows",
]

EXCLUDE_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", ".next", ".turbo", ".idea"}

def walk_tree(root: Path, max_depth: int = 3):
    items = []
    for path in sorted(root.rglob("*")):
        if any(part in EXCLUDE_DIRS for part in path.parts):
            continue
        rel = path.relative_to(root)
        if len(rel.parts) > max_depth:
            continue
        items.append(str(rel))
    return items

def detect_signals(root: Path):
    signals = []
    for item in IMPORTANT_FILES:
        p = root / item
        if p.exists():
            signals.append(item)
    assets = []
    for pattern in ("*.svg", "*.png", "*.jpg", "*.jpeg", "*.webp", "*.gif", "*.ico"):
        assets.extend(str(p.relative_to(root)) for p in root.rglob(pattern) if not any(part in EXCLUDE_DIRS for part in p.parts))
    return sorted(set(signals)), sorted(set(assets))[:100]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("repo", nargs="?", default=".")
    ap.add_argument("--max-depth", type=int, default=3)
    args = ap.parse_args()

    root = Path(args.repo).resolve()
    signals, assets = detect_signals(root)
    tree = walk_tree(root, args.max_depth)

    payload = {
        "repo": str(root),
        "signals": signals,
        "candidate_assets": assets,
        "tree_sample": tree[:250],
    }
    print(json.dumps(payload, indent=2))

if __name__ == "__main__":
    main()
