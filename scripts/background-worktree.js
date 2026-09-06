'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

// ---------------------------------------------------------------------------
// Deep module: background-worktree (git worktree isolation for write-mode)
// ---------------------------------------------------------------------------
function createWorktreeManager(deps) {
  const execGit =
    deps && typeof deps.execGit === 'function'
      ? deps.execGit
      : (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

  function numOrZero(text) {
    return /^\d+$/.test(String(text).trim()) ? parseInt(text, 10) : 0;
  }

  // Conflict signal per T-024: seven-angle-bracket hunks (+<<<<<<< in
  // diff-style output) or git's CONFLICT summary lines. Narrow enough that
  // normal merge-tree/diff output never matches.
  function hasConflictMarkers(text) {
    return /<<<<<<<|CONFLICT/.test(String(text || ''));
  }

  function gitFailureDetail(err) {
    if (!err) return 'unknown git error';
    const extra = err && (err.stderr || err.stdout);
    const detail = extra ? String(extra).trim() : '';
    const message = err && err.message ? String(err.message) : String(err);
    return detail && message.indexOf(detail) === -1 ? message + ' :: ' + detail : message;
  }

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

  // T-024 check-only merge report (NEVER merges): merge-base of the worktree
  // branch vs HEAD, per-file added/deleted counts via diff --numstat, and a
  // merge-tree probe for the conflict signal. Every git failure surfaces as a
  // contextual Error (never raw, never swallowed); callers treat 'high' as
  // "review before merging" — merging itself stays an explicit human step.
  async function diffReport(repoDir, worktree) {
    if (!repoDir || !worktree || !worktree.branch) {
      throw new Error('diffReport requires repoDir + worktree.branch');
    }
    const branch = String(worktree.branch);
    let base;
    try {
      base = String(execGit(['merge-base', branch, 'HEAD'], repoDir)).trim();
    } catch (err) {
      throw new Error('diffReport: merge-base failed for ' + branch + ': ' + gitFailureDetail(err));
    }
    if (!base) throw new Error('diffReport: empty merge-base for ' + branch);
    let numstat;
    try {
      numstat = String(execGit(['diff', '--numstat', base, branch], repoDir));
    } catch (err) {
      throw new Error('diffReport: diff --numstat failed for ' + branch + ': ' + gitFailureDetail(err));
    }
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of numstat.split('\n')) {
      if (!line.trim()) continue;
      const cols = line.split('\t');
      if (cols.length < 3) continue;
      filesChanged += 1;
      insertions += numOrZero(cols[0]);
      deletions += numOrZero(cols[1]);
    }
    let conflictProbability = 'low';
    try {
      const merged = String(execGit(['merge-tree', '--write-tree', base, branch], repoDir));
      if (hasConflictMarkers(merged)) conflictProbability = 'high';
    } catch (err) {
      // merge-tree exits non-zero on conflict: a conflict signal in the
      // failure output means 'high'; any other git failure is rethrown as a
      // contextual Error (never swallowed).
      if (hasConflictMarkers(gitFailureDetail(err))) conflictProbability = 'high';
      else throw new Error('diffReport: merge-tree failed for ' + branch + ': ' + gitFailureDetail(err));
    }
    return { filesChanged, insertions, deletions, conflictProbability, base };
  }

  return { setup, remove, branchExists, diffReport };
}

module.exports = { createWorktreeManager };
