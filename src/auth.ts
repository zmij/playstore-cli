/**
 * Google Play Console Authentication
 *
 * Handles service account authentication for Google Play Developer API.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { parse as parseYaml } from 'yaml';
import type { PlayStoreConfig } from './types.js';

export interface AuthContext {
  packageName: string;
  keyFilePath: string;
}

/**
 * Get the git worktree root directory
 */
export function getWorktreeRoot(): string {
  try {
    return execSync('git rev-parse --show-toplevel', { encoding: 'utf-8' }).trim();
  } catch {
    throw new Error('Not in a git repository');
  }
}

/**
 * Get the project root (parent of worktree if in a worktree)
 */
export function getProjectRoot(): string {
  const worktreeRoot = getWorktreeRoot();

  // Check if this is a worktree by looking for .git file (not directory)
  const gitPath = join(worktreeRoot, '.git');
  try {
    const stat = execSync(`file "${gitPath}"`, { encoding: 'utf-8' });
    if (stat.includes('ASCII text')) {
      // It's a worktree, .git is a file pointing to the main repo
      const gitContent = readFileSync(gitPath, 'utf-8').trim();
      const match = gitContent.match(/gitdir: (.+)/);
      if (match) {
        // Path like: /path/to/main/.git/worktrees/backend
        // We want: /path/to/main
        const gitDir = match[1];
        const mainGitDir = gitDir.replace(/\/\.git\/worktrees\/.*$/, '');
        return mainGitDir;
      }
    }
  } catch {
    // Not a worktree, use worktree root as project root
  }

  return worktreeRoot;
}

/**
 * Load Play Store configuration from .secret-stuff/playstore-config.yaml
 */
export function loadConfig(): PlayStoreConfig {
  const projectRoot = getProjectRoot();
  const configPath = join(projectRoot, '.secret-stuff', 'playstore-config.yaml');

  if (!existsSync(configPath)) {
    throw new Error(
      `Configuration not found: ${configPath}\n` +
        'Please create playstore-config.yaml with:\n' +
        '  package_name: "your.package.name"\n' +
        '  service_account_key: "service-account.json"'
    );
  }

  const content = readFileSync(configPath, 'utf-8');
  return parseYaml(content) as PlayStoreConfig;
}

/**
 * Get authentication context
 *
 * Key discovery order:
 * 1. --key-file CLI flag
 * 2. GOOGLE_PLAY_KEY_FILE environment variable
 * 3. Config file service_account_key (relative to .secret-stuff/)
 */
export function getAuthContext(keyFileOverride?: string): AuthContext {
  const config = loadConfig();
  const projectRoot = getProjectRoot();
  const secretsDir = join(projectRoot, '.secret-stuff');

  // Determine key file path
  let keyFilePath: string;

  if (keyFileOverride) {
    keyFilePath = keyFileOverride;
  } else if (process.env.GOOGLE_PLAY_KEY_FILE) {
    keyFilePath = process.env.GOOGLE_PLAY_KEY_FILE;
  } else {
    keyFilePath = join(secretsDir, config.service_account_key);
  }

  // Verify key file exists
  if (!existsSync(keyFilePath)) {
    throw new Error(`Service account key file not found: ${keyFilePath}`);
  }

  return {
    packageName: config.package_name,
    keyFilePath,
  };
}
