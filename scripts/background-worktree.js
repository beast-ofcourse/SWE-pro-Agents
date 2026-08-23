'use strict';

/**
 * background-worktree.js — git worktree isolation for write-mode delegations.
 *
 * A write-mode child runs in an isolated worktree (branch `bg-<id>`) so its
 * commits/branches never touch the parent working tree. The result is NEVER
 * auto-merged — the parent must `git merge` / `git worktree remove` manually
 * (explicit non-goal per validation #4).
 *
 * `execGit` is injectable so tests can use a real temp repo or a fake.
 */

const path = require('path');
const { execFileSync } = require('child_process');

function createWorktreeManager(deps) {
  const execGit = deps && typeof deps.execGit === 'function'
    ? deps.execGit
    : (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

  function branchExists(repoDir, branch) {
    try {
      execGit(['show-ref', '--verify', '--quiet', 'refs/heads/' + branch], repoDir);
      return true;
    } catch {
      return false;
    }
  }

  async function setup(repoDir, id) {
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    let branch = 'bg-' + safe;
    let suffix = 0;
    while (branchExists(repoDir, branch)) {
      suffix += 1;
      branch = 'bg-' + safe + '-' + suffix;
    }
    const wtPath = path.join(repoDir, '.worktrees', branch);
    execGit(['worktree', 'add', '-b', branch, wtPath], repoDir);
    return { path: wtPath, branch, repoDir };
  }

  async function remove(worktree) {
    if (!worktree || !worktree.path) return;
    const repo = worktree.repoDir;
    // Committed/clean worktree removes normally; uncommitted discards via --force.
    try {
      execGit(['worktree', 'remove', worktree.path], repo);
    } catch {
      execGit(['worktree', 'remove', '--force', worktree.path], repo);
    }
    if (branchExists(repo, worktree.branch)) {
      try {
        execGit(['branch', '-D', worktree.branch], repo);
      } catch {
        /* branch may be undeletable */
      }
    }
  }

  return { setup, remove, branchExists };
}

module.exports = { createWorktreeManager };
