/**
 * Google Play Console Authentication
 *
 * Handles service account authentication for the Google Play
 * Developer API. Loads config from the configured secrets directory
 * (default `.secret-stuff/`, override via `playstore-cli.config.yaml`
 * or `PLAYSTORE_SECRETS_DIR`).
 *
 * Path discovery (git roots, config-file lookup) lives in
 * `./project.ts` and `./paths.ts` to avoid circular imports.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { parse as parseYaml } from 'yaml';
import type { PlayStoreConfig } from './types.js';
import { getSecretsDir as resolveSecretsDir } from './paths.js';

// Re-export for back-compat — auth.ts was the original public source.
export { getProjectRoot, getWorktreeRoot } from './project.js';

const CONFIG_FILE = 'playstore-config.yaml';

export interface AuthContext {
  packageName: string;
  keyFilePath: string;
}

/**
 * Get the secrets directory.
 *
 * Re-exported from paths.ts. Configurable via
 * `playstore-cli.config.yaml` (`secrets_dir: ...`) at the project
 * root, or `PLAYSTORE_SECRETS_DIR`. Default `.secret-stuff/` at the
 * project root.
 */
export function getSecretsDir(): string {
  return resolveSecretsDir();
}

/**
 * Load Play Store configuration from the secrets directory.
 */
export function loadConfig(): PlayStoreConfig {
  const secretsDir = getSecretsDir();
  const configPath = join(secretsDir, CONFIG_FILE);

  if (!existsSync(configPath)) {
    throw new Error(
      `Configuration not found: ${configPath}\n` +
        `Please create ${CONFIG_FILE} in ${secretsDir}/ with:\n` +
        '  package_name: "your.package.name"\n' +
        '  service_account_key: "service-account.json"'
    );
  }

  const content = readFileSync(configPath, 'utf-8');
  return parseYaml(content) as PlayStoreConfig;
}

/**
 * Get authentication context.
 *
 * Service-account key discovery:
 *   1. `--key-file` CLI flag (caller-supplied override)
 *   2. `GOOGLE_PLAY_KEY_FILE` env var
 *   3. Config file `service_account_key` (relative to secrets dir)
 */
export function getAuthContext(keyFileOverride?: string): AuthContext {
  const config = loadConfig();
  const secretsDir = getSecretsDir();

  let keyFilePath: string;

  if (keyFileOverride) {
    keyFilePath = keyFileOverride;
  } else if (process.env.GOOGLE_PLAY_KEY_FILE) {
    keyFilePath = process.env.GOOGLE_PLAY_KEY_FILE;
  } else {
    keyFilePath = join(secretsDir, config.service_account_key);
  }

  if (!existsSync(keyFilePath)) {
    throw new Error(`Service account key file not found: ${keyFilePath}`);
  }

  return {
    packageName: config.package_name,
    keyFilePath,
  };
}
