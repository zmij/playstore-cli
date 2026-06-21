/**
 * Project- and worktree-root discovery via git.
 *
 * Pulled out of auth.ts so both auth.ts (secrets) and paths.ts
 * (metadata) can import without a circular dependency.
 *
 *   * worktree root  — `git rev-parse --show-toplevel`. Where
 *                      branch-specific files live (committed YAML).
 *   * project root   — the main repo's directory. For non-worktree
 *                      checkouts this matches the worktree root.
 *                      For worktrees, the directory that owns
 *                      `.git/worktrees/<name>/`. Where shared,
 *                      cross-branch resources live (secrets, .json
 *                      service-account keys).
 */

import { execSync, ExecSyncOptions } from 'child_process';
import { dirname } from 'path';

const GIT_OPTS: ExecSyncOptions = { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] };

export function getWorktreeRoot(): string {
  try {
    return (execSync('git rev-parse --show-toplevel', GIT_OPTS) as string).trim();
  } catch {
    throw new Error('Failed to determine worktree root. Make sure you are in a git repository.');
  }
}

export function getProjectRoot(): string {
  try {
    const gitCommonDir = (execSync('git rev-parse --git-common-dir', GIT_OPTS) as string).trim();

    // git-common-dir = ".git" means the main repo (not a worktree).
    if (gitCommonDir === '.git') {
      return (execSync('git rev-parse --show-toplevel', GIT_OPTS) as string).trim();
    }

    // Worktree: gitCommonDir is /path/to/main/.git → main is its parent.
    return dirname(gitCommonDir);
  } catch {
    throw new Error('Failed to determine project root. Make sure you are in a git repository.');
  }
}
