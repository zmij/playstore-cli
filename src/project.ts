/**
 * Project- and worktree-root discovery via git.
 *
 * Pulled out of auth.ts so both auth.ts (secrets) and paths.ts
 * (metadata) can import without a circular dependency.
 *
 *   * worktree root  — where branch-specific files live (committed
 *                      YAML). For most setups this is `git rev-parse
 *                      --show-toplevel`. When the CLI runs from a
 *                      directory that's checked out as a submodule
 *                      (e.g. when this package is vendored into a
 *                      parent monorepo), `--show-toplevel` returns
 *                      the submodule's own root, which is wrong for
 *                      finding the parent's metadata. We check
 *                      `--show-superproject-working-tree` first and
 *                      prefer it when non-empty.
 *   * project root   — the main repo's directory. For non-worktree
 *                      checkouts this matches the worktree root.
 *                      For worktrees, the directory that owns
 *                      `.git/worktrees/<name>/`. For submodules,
 *                      same superproject treatment as above.
 */

import { execSync } from 'child_process';
import { dirname } from 'path';

const GIT_OPTS = {
  encoding: 'utf-8' as const,
  stdio: ['pipe', 'pipe', 'pipe'] as ['pipe', 'pipe', 'pipe'],
};

/**
 * If we're running inside a submodule, return the superproject's
 * working tree. Otherwise return empty string (git prints nothing
 * outside submodule context). Older Git versions (<2.13) lack the
 * flag and will throw — treated as "no superproject".
 */
function showSuperproject(): string {
  try {
    return execSync('git rev-parse --show-superproject-working-tree', GIT_OPTS).trim();
  } catch {
    return '';
  }
}

export function getWorktreeRoot(): string {
  try {
    const superproject = showSuperproject();
    if (superproject) return superproject;
    return execSync('git rev-parse --show-toplevel', GIT_OPTS).trim();
  } catch {
    throw new Error('Failed to determine worktree root. Make sure you are in a git repository.');
  }
}

export function getProjectRoot(): string {
  try {
    // Submodule case: defer to the superproject's project root.
    const superproject = showSuperproject();
    if (superproject) return superproject;

    const gitCommonDir = execSync('git rev-parse --git-common-dir', GIT_OPTS).trim();

    // git-common-dir = ".git" means the main repo (not a worktree).
    if (gitCommonDir === '.git') {
      return execSync('git rev-parse --show-toplevel', GIT_OPTS).trim();
    }

    // Worktree: gitCommonDir is /path/to/main/.git → main is its parent.
    return dirname(gitCommonDir);
  } catch {
    throw new Error('Failed to determine project root. Make sure you are in a git repository.');
  }
}
