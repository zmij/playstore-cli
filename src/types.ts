/**
 * Google Play Console CLI Types
 */

// ============================================================================
// Authentication
// ============================================================================

export interface PlayStoreConfig {
  package_name: string;
  service_account_key: string;
}

// ============================================================================
// Metadata
// ============================================================================

export interface ListingMetadata {
  whats_new: string;
  title: string;
  short_description: string;
  full_description: string;
}

// ============================================================================
// Screenshots
// ============================================================================

export type ScreenshotUploadMode = 'replace' | 'add';

export interface ScreenshotOrder {
  order: string[];
}

export interface ParsedScreenshotFilename {
  language: string;
  device: string;
  orientation: 'p' | 'l';
  feature: string;
  timestamp: string;
  resolution: string;
  filename: string;
}

/**
 * Device type mapping to Google Play image types
 *
 * Google Play supports:
 * - phoneScreenshots: Phone screenshots
 * - sevenInchScreenshots: 7" tablet screenshots
 * - tenInchScreenshots: 10" tablet screenshots
 * - tvScreenshots: TV screenshots
 * - wearScreenshots: Wear OS screenshots
 */
export const DEVICE_TYPE_MAP: Record<string, string> = {
  // Phones
  'android-phone-wqhd': 'phoneScreenshots',
  'android-phone-fhd': 'phoneScreenshots',

  // Tablets
  'android-tablet-7': 'sevenInchScreenshots',
  'android-tablet-10': 'tenInchScreenshots',
};

/**
 * Language code mapping from our format to Google Play locale
 */
export const LANGUAGE_MAP: Record<string, string> = {
  'en': 'en-GB',
  'en-US': 'en-US',
  'en-GB': 'en-GB',
  'de': 'de-DE',
  'fr': 'fr-FR',
  'es': 'es-ES',
  'es-MX': 'es-419',
  'ar': 'ar',
  'fi': 'fi-FI',
  'he': 'iw-IL',
  'hi': 'hi-IN',
  'id': 'id',
  'ja': 'ja-JP',
  'ko': 'ko-KR',
  'pt': 'pt-BR',
  'pt-BR': 'pt-BR',
  'pt-PT': 'pt-PT',
  'ru': 'ru-RU',
  'zh': 'zh-CN',
};

/**
 * Languages that expand to multiple store locales for screenshots.
 * When uploading screenshots, files with these language prefixes
 * are uploaded to all listed locales.
 */
export const LOCALE_EXPAND: Record<string, string[]> = {
  'es': ['es-ES', 'es-419'],
  'pt': ['pt-BR', 'pt-PT'],
};

/**
 * Reverse mapping from Google Play locale to short name
 */
export const LOCALE_TO_SHORT: Record<string, string> = {
  'en-US': 'en',
  'en-GB': 'en-GB',
  'de-DE': 'de',
  'fr-FR': 'fr',
  'es-ES': 'es',
  'es-419': 'es-MX',
  'ar': 'ar',
  'fi-FI': 'fi',
  'iw-IL': 'he',
  'hi-IN': 'hi',
  'id': 'id',
  'ja-JP': 'ja',
  'ko-KR': 'ko',
  'pt-BR': 'pt',
  'pt-PT': 'pt-PT',
  'ru-RU': 'ru',
  'zh-CN': 'zh',
};

// ============================================================================
// API Response Types
// ============================================================================

export interface Track {
  track: string;
  releases: TrackRelease[];
}

export interface TrackRelease {
  name?: string;
  versionCodes?: string[];
  status: string;
  releaseNotes?: ReleaseNote[];
}

export interface ReleaseNote {
  language: string;
  text: string;
}

export interface Listing {
  language: string;
  title: string;
  shortDescription: string;
  fullDescription: string;
}

// ============================================================================
// Command Options
// ============================================================================

export interface ListingsUpdateOptions {
  all?: boolean;
  lang?: string;
  field?: 'whats_new' | 'title' | 'short_description' | 'full_description';
  dryRun?: boolean;
  keyFile?: string;
}

export interface ScreenshotsUploadOptions {
  source: string;
  lang?: string;
  all?: boolean;
  mode: ScreenshotUploadMode;
  keyFile?: string;
}

export interface ReadOptions {
  lang?: string;
  keyFile?: string;
}
