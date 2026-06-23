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
  /**
   * YouTube URL for the listing's promo video. The Play Store accepts
   * one video per locale, supplied as a YouTube URL — Play embeds it on
   * the listing alongside the screenshots. Empty string = no video set.
   * Example: `https://www.youtube.com/watch?v=dQw4w9WgXcQ`
   */
  promo_video: string;
}

// ============================================================================
// IAP Metadata (one-time products + subscriptions + base plans + offers)
// ============================================================================
//
// Play's IAP surface split in mid-2023:
//   * legacy `inappproducts` API — deprecated for newer accounts; calls
//     to .list / .batchGet fail with 403 "Please migrate to the new
//     publishing API." Don't use.
//   * new `monetization.onetimeproducts` API — Product → PurchaseOption
//     → Offer, structurally the mirror of `monetization.subscriptions`
//     (Sub → BasePlan → Offer). This is what we model.
//   * `monetization.subscriptions` API — unchanged, auto-renewing subs.

/**
 * Play uses `Money { currencyCode, units, nanos }` for every price. units
 * is the whole-currency part (e.g. 4 for $4.99); nanos is the fractional
 * part in 10^-9 — i.e. cents × 10^7, or `(cents / 100) * 10^9`. So 0.99
 * = `units: 0, nanos: 990_000_000` and €4.99 = `units: 4, nanos:
 * 990_000_000`. Units is `string` on the wire (the API permits >2^53
 * values); we widen to number in YAML for human readability.
 */
export interface PlayMoney {
  currency_code: string;
  units: number;
  nanos: number;
}

/** Region availability state from the wire `availability` enum,
 *  lower-cased. Common: `available` (offer/option is purchasable in
 *  this region), `no_longer_available` (existing buyers keep entitlement
 *  but the product is hidden in the store). */
export type PlayAvailability = 'available' | 'no_longer_available' | 'available_if_released';

/** Per-region pricing on a purchase option or offer. Region codes are
 *  ISO 3166-1 alpha-2 ("US", "DE") — unlike Apple's ISO-3. The price's
 *  `currency_code` must match the region's local currency (Play
 *  enforces this; e.g. region GB requires GBP). */
export interface RegionalPriceConfig {
  region: string;
  price: PlayMoney;
  availability?: PlayAvailability;
}

/** Localised title + description + (subs only) up to 4 benefit
 *  strings shown on the listing. */
export interface PlayListing {
  title: string;
  description: string;
  benefits?: string[];
}

/** A single offer on a one-time product (typically a launch discount
 *  or pre-order). Mirrors `Schema$OneTimeProductOffer`. */
export interface OneTimeProductOffer {
  offer_id: string;
  /** Output-only on the wire; round-tripped for YAML truth. */
  state?: 'draft' | 'active' | 'inactive';
  offer_tags?: string[];
  /** Pick exactly one offer kind. */
  discounted?: {
    start_time?: string;
    end_time?: string;
    /** 1-50 redemptions, or omitted/0 for unlimited. */
    redemption_limit?: number;
  };
  pre_order?: {
    end_time: string;
    /** ISO timestamp the product unlocks. */
    expected_release_time: string;
    price_change_behavior?: string;
  };
  /** Per-region modifier. Unlike subscription offers, one-time offers
   *  cannot set a flat price — they can only discount the purchase
   *  option's price (absolute or relative) or fall back to that price
   *  unchanged via `no_override`. */
  regional_configs?: Array<{
    region: string;
    availability?: PlayAvailability;
    /** Pick one. */
    absolute_discount?: PlayMoney;
    relative_discount?: number;
    no_override?: boolean;
  }>;
}

/** A purchase option on a one-time product. The default for a managed
 *  product is exactly one `buy` purchase option, but Play supports
 *  multiple (e.g. one buy + one rent, or per-tier variants). */
export interface PurchaseOption {
  purchase_option_id: string;
  /** Output-only on the wire; round-tripped. */
  state?: 'draft' | 'active' | 'inactive';
  /** Pick one. */
  buy?: {
    /** Marks this option as the one returned by the deprecated PBL
     *  flows that pre-date the one-time-products model. Only one per
     *  product. */
    legacy_compatible?: boolean;
    /** Whether buyers can purchase >1 in a single checkout. */
    multi_quantity_enabled?: boolean;
  };
  rent?: {
    /** ISO 8601 duration the user retains entitlement after purchase. */
    rental_period: string;
    /** Optional grace period after consumption start before revocation. */
    expiration_period?: string;
  };
  /** Fallback pricing for any region Play opens in future. At least one of
   *  `usd_price` / `eur_price` should be set; both is fine. When only one
   *  is provided, Play uses that single anchor for new-region pricing. The
   *  anchor is also used by `iap create`/`sync` to expand into per-region
   *  `regional_configs` via `monetization.convertRegionPrices` when the
   *  YAML doesn't carry explicit ones (#2428). */
  new_regions?: {
    usd_price?: PlayMoney;
    eur_price?: PlayMoney;
    availability?: PlayAvailability;
  };
  /** Explicit per-region pricing. Currency must match the region's
   *  local currency. */
  regional_configs?: RegionalPriceConfig[];
  offer_tags?: string[];
  /** Offers attached to this purchase option. Nested for YAML
   *  ergonomics; on the wire offers live in a sibling sub-resource. */
  offers?: OneTimeProductOffer[];
}

export interface OneTimeProduct {
  /** Per-lang listings keyed by BCP-47 lang code. Wire returns these
   *  as an array of `{ languageCode, title, description }`; we
   *  collapse to a map for ergonomics. */
  listings: Record<string, PlayListing>;
  purchase_options: PurchaseOption[];
  offer_tags?: string[];
}

/** A single phase of a subscription offer: a duration + a price
 *  treatment (free, fixed price, absolute discount, or relative
 *  discount). Phases run in order; the offer ends when the last phase
 *  completes. */
export interface SubscriptionOfferPhase {
  /** ISO 8601 duration of ONE phase recurrence. e.g. `P7D`, `P1M`. */
  duration: string;
  /** How many times the phase repeats. e.g. duration P1M ×
   *  recurrence_count 3 = 3 months of this phase. */
  recurrence_count: number;
  /** Phase pricing mode (mutually exclusive — pick one). Mirrors
   *  `RegionalSubscriptionOfferPhaseConfig`. */
  free?: boolean;
  price?: PlayMoney;
  absolute_discount?: PlayMoney;
  /** Wire field `relativeDiscount` (0..1 exclusive). 0.5 = 50% off
   *  the base plan price prorated over the phase. */
  relative_discount?: number;
}

export interface SubscriptionOffer {
  offer_id: string;
  /** Output-only on the wire; we round-trip it so YAML carries the
   *  truth. `draft` / `active` / `inactive`. */
  state?: 'draft' | 'active' | 'inactive';
  /** Up to 20 short tags surfaced through the Billing Library. */
  offer_tags?: string[];
  /** Targeting rule. Common: { new_subscriber: true } for intro
   *  offers, { upgrade: true } for retention. Omitted = available to
   *  everyone matching the base plan. */
  targeting?: {
    new_subscriber?: boolean;
    upgrade?: boolean;
  };
  /** Phase ladder; ordered. Phase 0 runs first. */
  phases: SubscriptionOfferPhase[];
}

export interface BasePlan {
  base_plan_id: string;
  /** Output-only on the wire; round-tripped here. */
  state?: 'draft' | 'active' | 'inactive';
  /** Pick exactly one billing type. `auto_renewing` is the common
   *  "monthly / yearly" case. */
  auto_renewing?: {
    /** ISO 8601: P1W / P1M / P3M / P6M / P1Y */
    billing_period: string;
    /** ISO 8601: P0D / P3D / P7D / P14D / P30D. Optional. */
    grace_period?: string;
    /** Marks this plan as the one returned by the deprecated
     *  `querySkuDetailsAsync()`. Only one per sub. */
    legacy_compatible?: boolean;
  };
  prepaid?: {
    billing_period: string;
  };
  /** Fallback pricing for any region Play opens in future that we
   *  haven't explicitly priced. Both `usd_price` and `eur_price` are
   *  required when this block is present. */
  other_regions?: {
    usd_price: PlayMoney;
    eur_price: PlayMoney;
    /** Whether the plan is purchasable in new regions by default. */
    new_subscriber_availability?: boolean;
  };
  /** Explicit per-region pricing overrides. */
  regional_configs?: Array<{
    region: string;
    price: PlayMoney;
    new_subscriber_availability?: boolean;
  }>;
  /** Offers attached to this base plan (intro free trials,
   *  promotional pricing, etc). */
  offers?: SubscriptionOffer[];
  /** Up to 20 tags surfaced through the Billing Library. */
  offer_tags?: string[];
}

export interface PlaySubscription {
  /** Per-lang listings; benefits[] is shown on the Play Store
   *  subscription sheet (up to 4 strings, each plain text). */
  listings: Record<string, PlayListing>;
  base_plans: BasePlan[];
}

export interface PlayIAPMetadata {
  /** One-time products via `monetization.onetimeproducts`. Keyed by
   *  productId. */
  purchases: Record<string, OneTimeProduct>;
  /** Auto-renewing subscriptions via `monetization.subscriptions`.
   *  Keyed by productId. Unlike Apple, Play has no concept of
   *  "subscription groups" — each subscription stands alone. */
  subscriptions: Record<string, PlaySubscription>;
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
  /** YouTube URL for the promo video. Empty string when no video is set. */
  video: string;
}

// ============================================================================
// Command Options
// ============================================================================

export interface ListingsUpdateOptions {
  all?: boolean;
  lang?: string;
  field?: 'whats_new' | 'title' | 'short_description' | 'full_description' | 'promo_video';
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
