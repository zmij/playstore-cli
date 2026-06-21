/**
 * Path conventions for the playstore-cli.
 *
 * Play (historically) splits metadata across two trees in the Lazy
 * Sudoku layout — `l10n/metadata/play/` for the newer IAP YAML, and
 * `l10n/metadata/google/` for the older listings + screenshots
 * tracks. We expose both as separate knobs so downstream projects
 * can:
 *
 *   * point them at the SAME directory (the typical greenfield
 *     setup), or
 *   * keep them split (the Lazy Sudoku case — preserved by the
 *     defaults below).
 *
 * Config file (optional) at the worktree root:
 *
 *   # playstore-cli.config.yaml
 *   secrets_dir:   config/playstore-secrets       # relative to project root
 *   metadata_dir:  store-metadata/play            # relative to worktree root; iap.yaml lives here
 *   listings_dir:  store-metadata/play/listings   # relative to worktree root; overrides {metadata_dir}/listings
 *
 * Env vars (highest priority):
 *
 *   PLAYSTORE_SECRETS_DIR=...
 *   PLAYSTORE_METADATA_DIR=...
 *   PLAYSTORE_LISTINGS_DIR=...
 *
 * Precedence: env > config file > built-in default.
 */

import { existsSync, readFileSync } from 'fs';
import { isAbsolute, join } from 'path';
import { parse as parseYaml } from 'yaml';
import { getProjectRoot, getWorktreeRoot } from './project.js';

const DEFAULT_SECRETS_DIR = '.secret-stuff';
const DEFAULT_METADATA_DIR = 'l10n/metadata/play';
// Lazy Sudoku historical split: listings + screenshots live under
// l10n/metadata/google/, separate from the newer IAP YAML. Downstream
// projects without that split can leave LISTINGS_DIR unset; we'll
// fall back to {metadata_dir}/listings + /screenshots.
const LAZY_SUDOKU_LISTINGS_DIR = 'l10n/metadata/google';
const PROJECT_CONFIG_FILE = 'playstore-cli.config.yaml';

interface PathsConfig {
  secrets_dir?: string;
  metadata_dir?: string;
  /** Override only when listings/screenshots live somewhere
   *  different from iap.yaml. Unset → falls back to
   *  `{metadata_dir}/listings`. */
  listings_dir?: string;
}

let cachedConfig: PathsConfig | null = null;

function loadPathsConfig(): PathsConfig {
  if (cachedConfig !== null) return cachedConfig;

  const candidates = [
    join(getWorktreeRoot(), PROJECT_CONFIG_FILE),
    join(getProjectRoot(), PROJECT_CONFIG_FILE),
  ];

  for (const path of candidates) {
    if (existsSync(path)) {
      const parsed = parseYaml(readFileSync(path, 'utf-8')) as PathsConfig | null;
      cachedConfig = parsed ?? {};
      return cachedConfig;
    }
  }

  cachedConfig = {};
  return cachedConfig;
}

function resolveRelative(root: string, value: string): string {
  return isAbsolute(value) ? value : join(root, value);
}

/** Secrets directory — where `playstore-config.yaml` + the
 *  service-account JSON live. Resolves against project root. */
export function getSecretsDir(): string {
  const fromEnv = process.env.PLAYSTORE_SECRETS_DIR;
  const fromConfig = loadPathsConfig().secrets_dir;
  const value = fromEnv ?? fromConfig ?? DEFAULT_SECRETS_DIR;
  return resolveRelative(getProjectRoot(), value);
}

/** Metadata directory — where iap.yaml + (by default) listings
 *  and screenshots live. Resolves against worktree root. */
export function getMetadataDir(): string {
  const fromEnv = process.env.PLAYSTORE_METADATA_DIR;
  const fromConfig = loadPathsConfig().metadata_dir;
  const value = fromEnv ?? fromConfig ?? DEFAULT_METADATA_DIR;
  return resolveRelative(getWorktreeRoot(), value);
}

/** Path to `{metadata_dir}/iap.yaml`. */
export function getIapYamlPath(): string {
  return join(getMetadataDir(), 'iap.yaml');
}

/** Base directory for listings + screenshots. Defaults to the Lazy
 *  Sudoku historical split (`l10n/metadata/google`). Downstream
 *  projects with a unified layout can override to `{metadata_dir}`
 *  via the `listings_dir` config knob. */
function getListingsBaseDir(): string {
  const fromEnv = process.env.PLAYSTORE_LISTINGS_DIR;
  const fromConfig = loadPathsConfig().listings_dir;
  // Default = historical split (LAZY_SUDOKU_LISTINGS_DIR). New
  // greenfield projects should set `listings_dir: {metadata_dir}` in
  // their config to unify the trees.
  const value = fromEnv ?? fromConfig ?? LAZY_SUDOKU_LISTINGS_DIR;
  return resolveRelative(getWorktreeRoot(), value);
}

/** Path to `{listings_base}/listings/`. */
export function getListingsDir(): string {
  return join(getListingsBaseDir(), 'listings');
}

/** Path to `{listings_base}/screenshots/order.yaml`. */
export function getScreenshotsOrderPath(): string {
  return join(getListingsBaseDir(), 'screenshots', 'order.yaml');
}

/** Path to `{listings_base}/` itself — useful for tracks files
 *  that sit at the root of the listings tree. */
export function getTracksBaseDir(): string {
  return getListingsBaseDir();
}

export function clearPathsCache(): void {
  cachedConfig = null;
}
