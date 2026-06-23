/**
 * Google Play Developer API Client Wrapper
 *
 * Provides a high-level interface to the Google Play Developer API
 * using the googleapis package.
 */

import { google } from 'googleapis';
import type { androidpublisher_v3 } from 'googleapis';
import { getAuthContext, type AuthContext } from './auth.js';
import type { Track, Listing } from './types.js';

type AndroidPublisher = androidpublisher_v3.Androidpublisher;
type Schema$OneTimeProduct = androidpublisher_v3.Schema$OneTimeProduct;
type Schema$OneTimeProductOffer = androidpublisher_v3.Schema$OneTimeProductOffer;
type Schema$Subscription = androidpublisher_v3.Schema$Subscription;
type Schema$SubscriptionOffer = androidpublisher_v3.Schema$SubscriptionOffer;

/**
 * Google Play Developer API Client
 */
export class PlayStoreClient {
  private publisher: AndroidPublisher;
  private packageName: string;
  private currentEditId: string | null = null;

  constructor(authContext: AuthContext) {
    const auth = new google.auth.GoogleAuth({
      keyFile: authContext.keyFilePath,
      scopes: ['https://www.googleapis.com/auth/androidpublisher'],
    });

    this.publisher = google.androidpublisher({
      version: 'v3',
      auth,
    });

    this.packageName = authContext.packageName;
  }

  // ============================================================================
  // Edit Management
  // ============================================================================

  /**
   * Start a new edit session
   * All modifications must be done within an edit, then committed
   */
  async startEdit(): Promise<string> {
    const response = await this.publisher.edits.insert({
      packageName: this.packageName,
    });

    this.currentEditId = response.data.id || null;
    if (!this.currentEditId) {
      throw new Error('Failed to start edit session');
    }

    return this.currentEditId;
  }

  /**
   * Commit the current edit to apply changes
   */
  async commitEdit(): Promise<void> {
    if (!this.currentEditId) {
      throw new Error('No active edit session');
    }

    await this.publisher.edits.commit({
      packageName: this.packageName,
      editId: this.currentEditId,
    });

    this.currentEditId = null;
  }

  /**
   * Delete the current edit without applying changes
   */
  async deleteEdit(): Promise<void> {
    if (!this.currentEditId) {
      return;
    }

    try {
      await this.publisher.edits.delete({
        packageName: this.packageName,
        editId: this.currentEditId,
      });
    } catch {
      // Ignore errors when deleting edit
    }

    this.currentEditId = null;
  }

  /**
   * Get or create an edit ID for operations
   */
  private async ensureEdit(): Promise<string> {
    if (!this.currentEditId) {
      await this.startEdit();
    }
    return this.currentEditId!;
  }

  // ============================================================================
  // Tracks
  // ============================================================================

  /**
   * List all release tracks
   */
  async listTracks(): Promise<Track[]> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.tracks.list({
      packageName: this.packageName,
      editId,
    });

    return (response.data.tracks || []).map((t) => ({
      track: t.track || '',
      releases: (t.releases || []).map((r) => ({
        name: r.name || undefined,
        versionCodes: r.versionCodes?.map(String) || [],
        status: r.status || 'unknown',
        releaseNotes: r.releaseNotes?.map((n) => ({
          language: n.language || '',
          text: n.text || '',
        })),
      })),
    }));
  }

  /**
   * Get a specific track
   */
  async getTrack(track: string): Promise<Track | null> {
    const editId = await this.ensureEdit();

    try {
      const response = await this.publisher.edits.tracks.get({
        packageName: this.packageName,
        editId,
        track,
      });

      const t = response.data;
      return {
        track: t.track || '',
        releases: (t.releases || []).map((r) => ({
          name: r.name || undefined,
          versionCodes: r.versionCodes?.map(String) || [],
          status: r.status || 'unknown',
          releaseNotes: r.releaseNotes?.map((n) => ({
            language: n.language || '',
            text: n.text || '',
          })),
        })),
      };
    } catch {
      return null;
    }
  }

  /**
   * Update a track with new releases
   */
  async updateTrack(
    track: string,
    releases: Array<{
      versionCodes: string[];
      status: string;
      releaseNotes?: Array<{ language: string; text: string }>;
    }>
  ): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.tracks.update({
      packageName: this.packageName,
      editId,
      track,
      requestBody: {
        track,
        releases: releases.map((r) => ({
          versionCodes: r.versionCodes,
          status: r.status,
          releaseNotes: r.releaseNotes?.map((n) => ({
            language: n.language,
            text: n.text,
          })),
        })),
      },
    });
  }

  // ============================================================================
  // Listings
  // ============================================================================

  /**
   * List all store listings
   */
  async listListings(): Promise<Listing[]> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.listings.list({
      packageName: this.packageName,
      editId,
    });

    return (response.data.listings || []).map((l) => ({
      language: l.language || '',
      title: l.title || '',
      shortDescription: l.shortDescription || '',
      fullDescription: l.fullDescription || '',
      video: l.video || '',
    }));
  }

  /**
   * Get a specific listing by language
   */
  async getListing(language: string): Promise<Listing | null> {
    const editId = await this.ensureEdit();

    try {
      const response = await this.publisher.edits.listings.get({
        packageName: this.packageName,
        editId,
        language,
      });

      const l = response.data;
      return {
        language: l.language || '',
        title: l.title || '',
        shortDescription: l.shortDescription || '',
        fullDescription: l.fullDescription || '',
        video: l.video || '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Update a store listing
   */
  async updateListing(
    language: string,
    data: Partial<{
      title: string;
      shortDescription: string;
      fullDescription: string;
      video: string;
    }>
  ): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.listings.update({
      packageName: this.packageName,
      editId,
      language,
      requestBody: data,
    });
  }

  // ============================================================================
  // Screenshots
  // ============================================================================

  /**
   * List screenshots for a language and image type
   */
  async listScreenshots(
    language: string,
    imageType: string
  ): Promise<{ id: string; url: string }[]> {
    const editId = await this.ensureEdit();

    try {
      const response = await this.publisher.edits.images.list({
        packageName: this.packageName,
        editId,
        language,
        imageType,
      });

      return (response.data.images || []).map((img) => ({
        id: img.id || '',
        url: img.url || '',
      }));
    } catch {
      return [];
    }
  }

  /**
   * Upload a screenshot
   */
  async uploadScreenshot(
    language: string,
    imageType: string,
    imageData: Buffer,
    mimeType: string = 'image/png'
  ): Promise<string> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.images.upload({
      packageName: this.packageName,
      editId,
      language,
      imageType,
      media: {
        mimeType,
        body: imageData as any,
      },
    });

    return response.data.image?.id || '';
  }

  /**
   * Delete a screenshot
   */
  async deleteScreenshot(
    language: string,
    imageType: string,
    imageId: string
  ): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.images.delete({
      packageName: this.packageName,
      editId,
      language,
      imageType,
      imageId,
    });
  }

  /**
   * Delete all screenshots for a language and image type
   */
  async deleteAllScreenshots(language: string, imageType: string): Promise<void> {
    const editId = await this.ensureEdit();

    await this.publisher.edits.images.deleteall({
      packageName: this.packageName,
      editId,
      language,
      imageType,
    });
  }

  // ============================================================================
  // App Details
  // ============================================================================

  /**
   * Get app details (contact info, default language)
   */
  async getAppDetails(): Promise<{
    contactEmail?: string;
    contactPhone?: string;
    contactWebsite?: string;
    defaultLanguage?: string;
  }> {
    const editId = await this.ensureEdit();

    const response = await this.publisher.edits.details.get({
      packageName: this.packageName,
      editId,
    });

    return {
      contactEmail: response.data.contactEmail || undefined,
      contactPhone: response.data.contactPhone || undefined,
      contactWebsite: response.data.contactWebsite || undefined,
      defaultLanguage: response.data.defaultLanguage || undefined,
    };
  }

  // ============================================================================
  // One-time products (the new monetization API)
  // ============================================================================
  //
  // Operations go DIRECTLY against the live package — no edit session,
  // no commit step (unlike listings / tracks / images). Don't call
  // ensureEdit() here or every read leaks an unwanted edit on the account.
  //
  // The legacy `inappproducts` API (defaultPrice + flat prices map + flat
  // listings map) is deprecated for newer accounts — calls fail with 403
  // "Please migrate to the new publishing API." Use
  // `monetization.onetimeproducts` exclusively.

  /** List every one-time product in the app. Paginated; we collect
   *  across pages so callers see one flat array. */
  async listOneTimeProducts(): Promise<Schema$OneTimeProduct[]> {
    const out: Schema$OneTimeProduct[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.publisher.monetization.onetimeproducts.list({
        packageName: this.packageName,
        pageToken,
      });
      out.push(...(res.data.oneTimeProducts ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  async getOneTimeProduct(productId: string): Promise<Schema$OneTimeProduct | null> {
    try {
      const res = await this.publisher.monetization.onetimeproducts.get({
        packageName: this.packageName,
        productId,
      });
      return res.data;
    } catch {
      return null;
    }
  }

  /** List every offer attached to one-time products. The List endpoint
   *  accepts productId='-' AND purchaseOptionId='-' as wildcards, which
   *  is how we pull the full picture in one round-trip. Returns empty
   *  array on 404 / no offers, never throws. */
  async listOneTimeProductOffers(
    productId: string = '-',
    purchaseOptionId: string = '-',
  ): Promise<Schema$OneTimeProductOffer[]> {
    const out: Schema$OneTimeProductOffer[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const res = await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.list({
          packageName: this.packageName,
          productId,
          purchaseOptionId,
          pageToken,
        });
        out.push(...(res.data.oneTimeProductOffers ?? []));
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
    } catch {
      // No offers attached, or product doesn't exist — fine for the
      // caller, which treats this as "no offers".
    }
    return out;
  }

  /** Patch a one-time product. Caller passes an explicit updateMask —
   *  Google rejects `*` here, so we enumerate the YAML-tracked fields
   *  by default: `listings`, `purchaseOptions`, `offerTags`. The
   *  `regionsVersion` is required by the API; copy from the current
   *  GET response so callers stay on Play's current regions snapshot
   *  unless they explicitly bump it. `allowMissing: true` lets the
   *  same call create a new product if the productId is fresh. */
  async upsertOneTimeProduct(
    productId: string,
    body: Schema$OneTimeProduct,
    regionsVersion: string,
    options: { updateMask?: string; allowMissing?: boolean } = {},
  ): Promise<Schema$OneTimeProduct> {
    const res = await this.publisher.monetization.onetimeproducts.patch({
      packageName: this.packageName,
      productId,
      'regionsVersion.version': regionsVersion,
      updateMask: options.updateMask ?? 'listings,purchaseOptions,offerTags',
      allowMissing: options.allowMissing ?? false,
      requestBody: body,
    });
    return res.data;
  }

  /** Patch a subscription. Same shape as one-time-product upsert.
   *  Default updateMask covers `listings` + `basePlans` — the YAML
   *  tracks both. Base-plan + offer STATE (DRAFT / ACTIVE / INACTIVE)
   *  is output-only here; lifecycle goes through dedicated
   *  activate/deactivate endpoints (not exposed on this client yet —
   *  Phase 2 sticks to content + pricing). */
  async upsertSubscription(
    productId: string,
    body: Schema$Subscription,
    regionsVersion: string,
    options: { updateMask?: string; allowMissing?: boolean } = {},
  ): Promise<Schema$Subscription> {
    const res = await this.publisher.monetization.subscriptions.patch({
      packageName: this.packageName,
      productId,
      'regionsVersion.version': regionsVersion,
      updateMask: options.updateMask ?? 'listings,basePlans',
      allowMissing: options.allowMissing ?? false,
      requestBody: body,
    });
    return res.data;
  }

  /** Create a NEW subscription via the dedicated `create` endpoint.
   *  Fails on already-exists; use `upsertSubscription` for in-place
   *  edits. Newly created base plans land in DRAFT state and need a
   *  follow-up activate call before they show in the store. */
  async createSubscription(
    productId: string,
    body: Schema$Subscription,
    regionsVersion: string,
  ): Promise<Schema$Subscription> {
    const res = await this.publisher.monetization.subscriptions.create({
      packageName: this.packageName,
      productId,
      'regionsVersion.version': regionsVersion,
      requestBody: body,
    });
    return res.data;
  }

  // ============================================================================
  // State lifecycle (activate / deactivate)
  // ============================================================================
  //
  // patch endpoints leave state output-only — Play preserves whatever
  // was there. To actually flip a base plan / offer / purchase option
  // between active and inactive you need the dedicated endpoints below.
  //
  // Cross-cutting quirk: one-time PURCHASE OPTIONS don't have
  // individual activate / deactivate — Play only exposes
  // batchUpdateStates for them. We surface that as `setOneTimePurchaseOptionStates`
  // taking an array of (purchaseOptionId, state) pairs. Single-item
  // calls work fine.

  async activateBasePlan(productId: string, basePlanId: string): Promise<void> {
    await this.publisher.monetization.subscriptions.basePlans.activate({
      packageName: this.packageName,
      productId,
      basePlanId,
      requestBody: {},
    });
  }

  async deactivateBasePlan(productId: string, basePlanId: string): Promise<void> {
    await this.publisher.monetization.subscriptions.basePlans.deactivate({
      packageName: this.packageName,
      productId,
      basePlanId,
      requestBody: {},
    });
  }

  async activateSubscriptionOffer(
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Promise<void> {
    await this.publisher.monetization.subscriptions.basePlans.offers.activate({
      packageName: this.packageName,
      productId,
      basePlanId,
      offerId,
      requestBody: {},
    });
  }

  async deactivateSubscriptionOffer(
    productId: string,
    basePlanId: string,
    offerId: string,
  ): Promise<void> {
    await this.publisher.monetization.subscriptions.basePlans.offers.deactivate({
      packageName: this.packageName,
      productId,
      basePlanId,
      offerId,
      requestBody: {},
    });
  }

  async activateOneTimeOffer(
    productId: string,
    purchaseOptionId: string,
    offerId: string,
  ): Promise<void> {
    await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.activate({
      packageName: this.packageName,
      productId,
      purchaseOptionId,
      offerId,
      requestBody: {},
    });
  }

  async deactivateOneTimeOffer(
    productId: string,
    purchaseOptionId: string,
    offerId: string,
  ): Promise<void> {
    await this.publisher.monetization.onetimeproducts.purchaseOptions.offers.deactivate({
      packageName: this.packageName,
      productId,
      purchaseOptionId,
      offerId,
      requestBody: {},
    });
  }

  /** Migrate existing subscribers on a base plan to whatever its
   *  current price is, region by region. Use AFTER `iap sync` has
   *  set the new price — patching the price only affects new
   *  subscribers; this call moves the existing cohort.
   *
   *  Each entry's `oldestAllowedPriceVersionTime` is a cutoff: anyone
   *  signed up before that time gets migrated. Pass the current
   *  instant ("now") to migrate everyone on the old price; an earlier
   *  cutoff lets you preserve a recent cohort if you've done a phased
   *  rollout.
   *
   *  `priceIncreaseType` is optional:
   *   * PRICE_INCREASE_TYPE_OPT_IN — user must explicitly accept;
   *     declines cancel the subscription at expiry.
   *   * PRICE_INCREASE_TYPE_OPT_OUT — applied automatically; user can
   *     cancel. (Required for price decreases? No — decreases are
   *     always auto-applied.)
   *   Omitted = Play's default (opt-in for increases).
   *
   *  The endpoint accepts cross-sub batches via productId='-' on the
   *  URL; we expose that by letting the caller batch one or many
   *  base-plan migrations per call. */
  async batchMigrateBasePlanPrices(
    productId: string,
    regionsVersion: string,
    migrations: Array<{
      basePlanId: string;
      regionalPriceMigrations: Array<{
        regionCode: string;
        oldestAllowedPriceVersionTime: string;
        priceIncreaseType?: string;
      }>;
    }>,
  ): Promise<void> {
    if (migrations.length === 0) return;
    await this.publisher.monetization.subscriptions.basePlans.batchMigratePrices({
      packageName: this.packageName,
      productId,
      requestBody: {
        requests: migrations.map((m) => ({
          packageName: this.packageName,
          // The wire's productId on the per-request body is the
          // PARENT sub of this base plan. When the URL productId is
          // '-' you can mix subs; otherwise it must match.
          productId,
          basePlanId: m.basePlanId,
          regionsVersion: { version: regionsVersion },
          regionalPriceMigrations: m.regionalPriceMigrations,
        })),
      },
    });
  }

  /** Convert a single anchor price into per-region prices via Play's
   *  `monetization.convertRegionPrices`. The endpoint returns a map of
   *  region code → `{ price, taxAmount }` covering every region Play
   *  currently supports for that catalog version — same conversion the
   *  Play Console runs when you type one USD price and watch the
   *  per-country grid fill in.
   *
   *  Returned `Schema$Money` values are **tax inclusive** (Play's
   *  customer-facing price). The request anchor is tax exclusive, per
   *  Play's API contract. We surface the per-region tax-inclusive price
   *  directly because it's what `regional_configs[].price` expects on
   *  the patch payload.
   *
   *  Used by `iap create`/`sync` to expand a YAML purchase option whose
   *  `new_regions` carries only a USD anchor into the explicit
   *  `regional_configs` Play needs for the current ~173 markets to
   *  carry a price — without that expansion, the product creates as
   *  DRAFT with no price (see issue #2428).
   */
  async convertRegionPrices(
    anchor: androidpublisher_v3.Schema$Money,
  ): Promise<{
    perRegion: Map<string, androidpublisher_v3.Schema$Money>;
    otherRegionsUsd?: androidpublisher_v3.Schema$Money;
    otherRegionsEur?: androidpublisher_v3.Schema$Money;
  }> {
    const res = await this.publisher.monetization.convertRegionPrices({
      packageName: this.packageName,
      requestBody: { price: anchor },
    });
    const perRegion = new Map<string, androidpublisher_v3.Schema$Money>();
    const map = res.data.convertedRegionPrices ?? {};
    for (const [regionCode, entry] of Object.entries(map)) {
      if (entry?.price) perRegion.set(regionCode, entry.price);
    }
    return {
      perRegion,
      otherRegionsUsd: res.data.convertedOtherRegionsPrice?.usdPrice ?? undefined,
      otherRegionsEur: res.data.convertedOtherRegionsPrice?.eurPrice ?? undefined,
    };
  }

  /** Bulk update purchase-option states. The only state-transition
   *  endpoint Play exposes for one-time purchase options — there's no
   *  single activate / deactivate. Pass an array of `{ purchase_option_id,
   *  state }`. Each batch element nests the full activate/deactivate
   *  request (with packageName + productId + purchaseOptionId
   *  duplicated) under the discriminator key. */
  async setOneTimePurchaseOptionStates(
    productId: string,
    transitions: Array<{ purchaseOptionId: string; state: 'ACTIVE' | 'INACTIVE' }>,
  ): Promise<void> {
    if (transitions.length === 0) return;
    await this.publisher.monetization.onetimeproducts.purchaseOptions.batchUpdateStates({
      packageName: this.packageName,
      productId,
      requestBody: {
        requests: transitions.map((t) => (t.state === 'ACTIVE'
          ? {
            activatePurchaseOptionRequest: {
              packageName: this.packageName,
              productId,
              purchaseOptionId: t.purchaseOptionId,
            },
          }
          : {
            deactivatePurchaseOptionRequest: {
              packageName: this.packageName,
              productId,
              purchaseOptionId: t.purchaseOptionId,
            },
          })),
      },
    });
  }

  // ============================================================================
  // Subscriptions (new monetization API)
  // ============================================================================
  //
  // Subscriptions have nested resources: each Subscription carries its
  // basePlans inline, but Offers are a sub-resource we list separately. The
  // List endpoint accepts productId='-' and basePlanId='-' as wildcards
  // (single round-trip for all offers under the app), which is what we use
  // when callers want the full picture.

  async listSubscriptions(): Promise<Schema$Subscription[]> {
    const out: Schema$Subscription[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.publisher.monetization.subscriptions.list({
        packageName: this.packageName,
        pageToken,
      });
      out.push(...(res.data.subscriptions ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }

  async getSubscription(productId: string): Promise<Schema$Subscription | null> {
    try {
      const res = await this.publisher.monetization.subscriptions.get({
        packageName: this.packageName,
        productId,
      });
      return res.data;
    } catch {
      return null;
    }
  }

  /** List every subscription offer for one product (productId='-' for
   *  the whole app; basePlanId='-' for all base plans). The Offers
   *  list endpoint requires basePlanId='-' when productId='-'. */
  async listSubscriptionOffers(
    productId: string,
    basePlanId: string = '-',
  ): Promise<Schema$SubscriptionOffer[]> {
    const out: Schema$SubscriptionOffer[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.publisher.monetization.subscriptions.basePlans.offers.list({
        packageName: this.packageName,
        productId,
        basePlanId,
        pageToken,
      });
      out.push(...(res.data.subscriptionOffers ?? []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);
    return out;
  }
}

/**
 * Create a Play Store client with authentication
 */
export function createClient(keyFileOverride?: string): PlayStoreClient {
  const authContext = getAuthContext(keyFileOverride);
  return new PlayStoreClient(authContext);
}
