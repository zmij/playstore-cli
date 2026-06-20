/**
 * IAP Commands — one-time products + subscriptions + base plans + offers
 *
 * Mirrors the appstore-cli `iap` command surface. Play's quirks vs Apple:
 *  - two new-API backends: `monetization.onetimeproducts` (managed
 *    products) and `monetization.subscriptions` (auto-renewing). The
 *    legacy `inappproducts` API is dead for newer accounts. No edit
 *    session needed for either new backend.
 *  - no "subscription groups" — each subscription stands alone.
 *  - region codes are ISO-2 ("US", "DE"), not ISO-3 ("USA", "DEU").
 *  - pricing is concrete `Money { currencyCode, units, nanos }` per
 *    region, plus a `newRegionsConfig` USD+EUR fallback for any region
 *    Play opens in future. No Apple-style "anchor + tier" auto-equalise.
 *  - subscription intro/promo is a phase ladder on an Offer; one-time
 *    promo is a `discountedOffer` (start/end + redemption cap) attached
 *    to a purchase option.
 *  - no review-screenshot concept.
 *
 * Phase 1 ships read-only: `iap list`, `iap show`, `iap export`.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import type { androidpublisher_v3 } from 'googleapis';
import { createClient, type PlayStoreClient } from '../client.js';
import type {
  PlayIAPMetadata,
  OneTimeProduct,
  PlaySubscription,
  PlayListing,
  PlayMoney,
  BasePlan,
  SubscriptionOffer,
  SubscriptionOfferPhase,
  PurchaseOption,
  OneTimeProductOffer,
  RegionalPriceConfig,
  PlayAvailability,
} from '../types.js';

type Schema$OneTimeProduct = androidpublisher_v3.Schema$OneTimeProduct;
type Schema$OneTimeProductOffer = androidpublisher_v3.Schema$OneTimeProductOffer;
type Schema$OneTimeProductPurchaseOption = androidpublisher_v3.Schema$OneTimeProductPurchaseOption;
type Schema$Subscription = androidpublisher_v3.Schema$Subscription;
type Schema$SubscriptionOfferSDK = androidpublisher_v3.Schema$SubscriptionOffer;
type Schema$Money = androidpublisher_v3.Schema$Money;

// ============================================================================
// Wire ↔ YAML converters
// ============================================================================

/** Schema$Money → PlayMoney. units arrives as `string` (API permits
 *  values >2^53); we widen to number for YAML readability and throw if
 *  unsafe. */
function moneyFromWire(m: Schema$Money | undefined | null): PlayMoney | undefined {
  if (!m) return undefined;
  const units = m.units ? Number(m.units) : 0;
  if (!Number.isSafeInteger(units)) {
    throw new Error(`Money.units out of safe integer range: ${m.units}`);
  }
  return {
    currency_code: m.currencyCode ?? '',
    units,
    nanos: m.nanos ?? 0,
  };
}

function moneyToWire(m: PlayMoney): Schema$Money {
  return { currencyCode: m.currency_code, units: String(m.units), nanos: m.nanos };
}

function formatMoney(m: PlayMoney): string {
  const fractional = (m.nanos / 1_000_000_000).toFixed(2).slice(2);
  return `${m.units}.${fractional} ${m.currency_code}`;
}

/** Normalise the wire `availability` enum (`AVAILABLE`,
 *  `NO_LONGER_AVAILABLE`, `AVAILABLE_IF_RELEASED`) to lower-case-snake. */
function availabilityFromWire(a: string | null | undefined): PlayAvailability | undefined {
  if (!a) return undefined;
  return a.toLowerCase().replace(/^availability_/, '') as PlayAvailability;
}

/** YAML lower-case-snake → wire enum (UPPER_SNAKE_CASE). */
function availabilityToWire(a: PlayAvailability | undefined): string | undefined {
  if (!a) return undefined;
  return a.toUpperCase();
}

// ---------- one-time products -------------------------------------------------

function purchaseOptionFromWire(
  o: Schema$OneTimeProductPurchaseOption,
  offers: Schema$OneTimeProductOffer[],
): PurchaseOption {
  const out: PurchaseOption = {
    purchase_option_id: o.purchaseOptionId ?? '',
  };
  if (o.state) out.state = (o.state as string).toLowerCase().replace(/^purchase_option_state_/, '') as any;
  if (o.buyOption) {
    out.buy = {};
    if (o.buyOption.legacyCompatible) out.buy.legacy_compatible = true;
    if (o.buyOption.multiQuantityEnabled) out.buy.multi_quantity_enabled = true;
  }
  if (o.rentOption) {
    out.rent = {
      rental_period: o.rentOption.rentalPeriod ?? '',
      ...(o.rentOption.expirationPeriod && { expiration_period: o.rentOption.expirationPeriod }),
    };
  }
  if (o.newRegionsConfig?.usdPrice && o.newRegionsConfig?.eurPrice) {
    out.new_regions = {
      usd_price: moneyFromWire(o.newRegionsConfig.usdPrice)!,
      eur_price: moneyFromWire(o.newRegionsConfig.eurPrice)!,
      ...(o.newRegionsConfig.availability && {
        availability: availabilityFromWire(o.newRegionsConfig.availability),
      }),
    };
  }
  if (o.regionalPricingAndAvailabilityConfigs && o.regionalPricingAndAvailabilityConfigs.length > 0) {
    out.regional_configs = o.regionalPricingAndAvailabilityConfigs
      .filter((rc) => rc.regionCode && rc.price)
      .map((rc) => {
        const cfg: RegionalPriceConfig = {
          region: rc.regionCode!,
          price: moneyFromWire(rc.price)!,
        };
        if (rc.availability) cfg.availability = availabilityFromWire(rc.availability);
        return cfg;
      });
  }
  if (o.offerTags && o.offerTags.length > 0) {
    out.offer_tags = o.offerTags.map((t) => t.tag ?? '').filter(Boolean);
  }
  if (offers.length > 0) {
    out.offers = offers.map(oneTimeOfferFromWire);
  }
  return out;
}

function oneTimeOfferFromWire(o: Schema$OneTimeProductOffer): OneTimeProductOffer {
  const out: OneTimeProductOffer = {
    offer_id: o.offerId ?? '',
  };
  if (o.state) out.state = (o.state as string).toLowerCase().replace(/^one_time_product_offer_state_/, '') as any;
  if (o.offerTags && o.offerTags.length > 0) {
    out.offer_tags = o.offerTags.map((t) => t.tag ?? '').filter(Boolean);
  }
  if (o.discountedOffer) {
    out.discounted = {
      ...(o.discountedOffer.startTime && { start_time: o.discountedOffer.startTime }),
      ...(o.discountedOffer.endTime && { end_time: o.discountedOffer.endTime }),
      ...(o.discountedOffer.redemptionLimit && {
        redemption_limit: Number(o.discountedOffer.redemptionLimit),
      }),
    };
  }
  if (o.preOrderOffer) {
    out.pre_order = {
      end_time: o.preOrderOffer.endTime ?? '',
      expected_release_time: (o.preOrderOffer as any).expectedReleaseTime ?? '',
      ...((o.preOrderOffer as any).priceChangeBehavior && {
        price_change_behavior: (o.preOrderOffer as any).priceChangeBehavior,
      }),
    };
  }
  if (o.regionalPricingAndAvailabilityConfigs && o.regionalPricingAndAvailabilityConfigs.length > 0) {
    out.regional_configs = o.regionalPricingAndAvailabilityConfigs
      .filter((rc) => rc.regionCode)
      .map((rc) => {
        const cfg: NonNullable<OneTimeProductOffer['regional_configs']>[number] = {
          region: rc.regionCode!,
        };
        if (rc.availability) cfg.availability = availabilityFromWire(rc.availability);
        if (rc.absoluteDiscount) cfg.absolute_discount = moneyFromWire(rc.absoluteDiscount);
        if (rc.relativeDiscount != null) cfg.relative_discount = rc.relativeDiscount;
        if (rc.noOverride) cfg.no_override = true;
        return cfg;
      });
  }
  return out;
}

function oneTimeProductFromWire(
  p: Schema$OneTimeProduct,
  offers: Schema$OneTimeProductOffer[],
): OneTimeProduct {
  // Wire returns listings as an array of { languageCode, title,
  // description }; collapse to a map for YAML ergonomics.
  const listings: Record<string, PlayListing> = {};
  for (const l of p.listings ?? []) {
    const lang = l.languageCode;
    if (!lang) continue;
    listings[lang] = {
      title: l.title ?? '',
      description: l.description ?? '',
    };
  }

  // Bucket offers by purchaseOptionId so they nest under the option
  // they extend.
  const offersByOption = new Map<string, Schema$OneTimeProductOffer[]>();
  for (const o of offers) {
    const k = o.purchaseOptionId ?? '';
    if (!offersByOption.has(k)) offersByOption.set(k, []);
    offersByOption.get(k)!.push(o);
  }

  const purchase_options: PurchaseOption[] = (p.purchaseOptions ?? []).map((po) => {
    const optionOffers = offersByOption.get(po.purchaseOptionId ?? '') ?? [];
    return purchaseOptionFromWire(po, optionOffers);
  });

  const out: OneTimeProduct = { listings, purchase_options };
  if (p.offerTags && p.offerTags.length > 0) {
    out.offer_tags = p.offerTags.map((t) => t.tag ?? '').filter(Boolean);
  }
  return out;
}

// ---------- subscriptions -----------------------------------------------------

function subscriptionOfferFromWire(o: Schema$SubscriptionOfferSDK): SubscriptionOffer {
  const phases: SubscriptionOfferPhase[] = (o.phases ?? []).map((ph) => {
    // Pick the first region config to derive the human-visible price.
    // Per-region differences round-trip through the wire on push — for
    // the YAML shape we collapse to a representative value.
    const rc = ph.regionalConfigs?.[0];
    const phase: SubscriptionOfferPhase = {
      duration: ph.duration ?? '',
      recurrence_count: ph.recurrenceCount ?? 1,
    };
    if (rc?.free !== undefined && rc.free !== null) phase.free = true;
    else if (rc?.price) phase.price = moneyFromWire(rc.price);
    else if (rc?.absoluteDiscount) phase.absolute_discount = moneyFromWire(rc.absoluteDiscount);
    else if (rc?.relativeDiscount != null) phase.relative_discount = rc.relativeDiscount;
    return phase;
  });

  const out: SubscriptionOffer = {
    offer_id: o.offerId ?? '',
    phases,
  };
  if (o.state) out.state = (o.state as string).toLowerCase().replace(/^subscription_offer_state_/, '') as any;
  if (o.offerTags && o.offerTags.length > 0) {
    out.offer_tags = o.offerTags.map((t) => t.tag ?? '').filter(Boolean);
  }
  if (o.targeting) {
    const t: SubscriptionOffer['targeting'] = {};
    if (o.targeting.acquisitionRule) t.new_subscriber = true;
    if (o.targeting.upgradeRule) t.upgrade = true;
    if (Object.keys(t).length > 0) out.targeting = t;
  }
  return out;
}

function subscriptionFromWire(
  s: Schema$Subscription,
  offers: Schema$SubscriptionOfferSDK[],
): PlaySubscription {
  const listings: Record<string, PlayListing> = {};
  for (const l of s.listings ?? []) {
    const lang = l.languageCode ?? '';
    if (!lang) continue;
    listings[lang] = {
      title: l.title ?? '',
      description: l.description ?? '',
      ...(l.benefits && l.benefits.length > 0 && { benefits: l.benefits }),
    };
  }

  const offersByPlan = new Map<string, Schema$SubscriptionOfferSDK[]>();
  for (const o of offers) {
    const k = o.basePlanId ?? '';
    if (!offersByPlan.has(k)) offersByPlan.set(k, []);
    offersByPlan.get(k)!.push(o);
  }

  const base_plans: BasePlan[] = (s.basePlans ?? []).map((bp) => {
    const plan: BasePlan = {
      base_plan_id: bp.basePlanId ?? '',
    };
    if (bp.state) plan.state = (bp.state as string).toLowerCase().replace(/^base_plan_state_/, '') as any;
    if (bp.autoRenewingBasePlanType) {
      plan.auto_renewing = {
        billing_period: bp.autoRenewingBasePlanType.billingPeriodDuration ?? '',
        ...(bp.autoRenewingBasePlanType.gracePeriodDuration && {
          grace_period: bp.autoRenewingBasePlanType.gracePeriodDuration,
        }),
        ...(bp.autoRenewingBasePlanType.legacyCompatible && { legacy_compatible: true }),
      };
    }
    if (bp.prepaidBasePlanType) {
      plan.prepaid = {
        billing_period: bp.prepaidBasePlanType.billingPeriodDuration ?? '',
      };
    }
    if (bp.otherRegionsConfig?.usdPrice && bp.otherRegionsConfig?.eurPrice) {
      plan.other_regions = {
        usd_price: moneyFromWire(bp.otherRegionsConfig.usdPrice)!,
        eur_price: moneyFromWire(bp.otherRegionsConfig.eurPrice)!,
        ...(bp.otherRegionsConfig.newSubscriberAvailability && {
          new_subscriber_availability: true,
        }),
      };
    }
    if (bp.regionalConfigs && bp.regionalConfigs.length > 0) {
      plan.regional_configs = bp.regionalConfigs
        .filter((rc) => rc.regionCode && rc.price)
        .map((rc) => ({
          region: rc.regionCode!,
          price: moneyFromWire(rc.price)!,
          ...(rc.newSubscriberAvailability && { new_subscriber_availability: true }),
        }));
    }
    if (bp.offerTags && bp.offerTags.length > 0) {
      plan.offer_tags = bp.offerTags.map((t) => t.tag ?? '').filter(Boolean);
    }
    const planOffers = offersByPlan.get(plan.base_plan_id) ?? [];
    if (planOffers.length > 0) plan.offers = planOffers.map(subscriptionOfferFromWire);
    return plan;
  });

  return { listings, base_plans };
}

// ============================================================================
// YAML → wire converters (drive the sync push)
// ============================================================================

function oneTimeProductToWire(yamlProduct: OneTimeProduct): Schema$OneTimeProduct {
  return {
    listings: Object.entries(yamlProduct.listings).map(([lang, l]) => ({
      languageCode: lang,
      title: l.title,
      description: l.description,
    })),
    purchaseOptions: yamlProduct.purchase_options.map(purchaseOptionToWire),
    ...(yamlProduct.offer_tags && yamlProduct.offer_tags.length > 0 && {
      offerTags: yamlProduct.offer_tags.map((tag) => ({ tag })),
    }),
  };
}

function purchaseOptionToWire(po: PurchaseOption): Schema$OneTimeProductPurchaseOption {
  const out: Schema$OneTimeProductPurchaseOption = {
    purchaseOptionId: po.purchase_option_id,
  };
  if (po.buy) {
    out.buyOption = {
      ...(po.buy.legacy_compatible !== undefined && { legacyCompatible: po.buy.legacy_compatible }),
      ...(po.buy.multi_quantity_enabled !== undefined && {
        multiQuantityEnabled: po.buy.multi_quantity_enabled,
      }),
    };
  }
  if (po.rent) {
    out.rentOption = {
      rentalPeriod: po.rent.rental_period,
      ...(po.rent.expiration_period && { expirationPeriod: po.rent.expiration_period }),
    };
  }
  if (po.new_regions) {
    out.newRegionsConfig = {
      usdPrice: moneyToWire(po.new_regions.usd_price),
      eurPrice: moneyToWire(po.new_regions.eur_price),
      ...(po.new_regions.availability && {
        availability: availabilityToWire(po.new_regions.availability),
      }),
    };
  }
  if (po.regional_configs && po.regional_configs.length > 0) {
    out.regionalPricingAndAvailabilityConfigs = po.regional_configs.map((rc) => ({
      regionCode: rc.region,
      price: moneyToWire(rc.price),
      ...(rc.availability && { availability: availabilityToWire(rc.availability) }),
    }));
  }
  if (po.offer_tags && po.offer_tags.length > 0) {
    out.offerTags = po.offer_tags.map((tag) => ({ tag }));
  }
  return out;
}

function subscriptionToWire(yamlSub: PlaySubscription): Schema$Subscription {
  return {
    listings: Object.entries(yamlSub.listings).map(([lang, l]) => ({
      languageCode: lang,
      title: l.title,
      description: l.description,
      ...(l.benefits && l.benefits.length > 0 && { benefits: l.benefits }),
    })),
    basePlans: yamlSub.base_plans.map(basePlanToWire),
  };
}

function basePlanToWire(plan: BasePlan): androidpublisher_v3.Schema$BasePlan {
  const out: androidpublisher_v3.Schema$BasePlan = {
    basePlanId: plan.base_plan_id,
  };
  if (plan.auto_renewing) {
    out.autoRenewingBasePlanType = {
      billingPeriodDuration: plan.auto_renewing.billing_period,
      ...(plan.auto_renewing.grace_period && {
        gracePeriodDuration: plan.auto_renewing.grace_period,
      }),
      ...(plan.auto_renewing.legacy_compatible && { legacyCompatible: true }),
    };
  }
  if (plan.prepaid) {
    out.prepaidBasePlanType = {
      billingPeriodDuration: plan.prepaid.billing_period,
    };
  }
  if (plan.other_regions) {
    out.otherRegionsConfig = {
      usdPrice: moneyToWire(plan.other_regions.usd_price),
      eurPrice: moneyToWire(plan.other_regions.eur_price),
      ...(plan.other_regions.new_subscriber_availability && {
        newSubscriberAvailability: true,
      }),
    };
  }
  if (plan.regional_configs && plan.regional_configs.length > 0) {
    out.regionalConfigs = plan.regional_configs.map((rc) => ({
      regionCode: rc.region,
      price: moneyToWire(rc.price),
      ...(rc.new_subscriber_availability && { newSubscriberAvailability: true }),
    }));
  }
  if (plan.offer_tags && plan.offer_tags.length > 0) {
    out.offerTags = plan.offer_tags.map((tag) => ({ tag }));
  }
  return out;
}

// ============================================================================
// Live-state harvester (shared by list / show / export)
// ============================================================================

async function fetchLiveIapState(
  client: PlayStoreClient,
  logProgress: boolean,
): Promise<PlayIAPMetadata> {
  const metadata: PlayIAPMetadata = { purchases: {}, subscriptions: {} };

  // -- One-time products + their offers -------------------------------
  const [products, allOneTimeOffers] = await Promise.all([
    client.listOneTimeProducts(),
    client.listOneTimeProductOffers('-', '-'),
  ]);

  const oneTimeOffersByProduct = new Map<string, Schema$OneTimeProductOffer[]>();
  for (const o of allOneTimeOffers) {
    const k = o.productId ?? '';
    if (!oneTimeOffersByProduct.has(k)) oneTimeOffersByProduct.set(k, []);
    oneTimeOffersByProduct.get(k)!.push(o);
  }

  for (const p of products) {
    const productId = p.productId;
    if (!productId) continue;
    const productOffers = oneTimeOffersByProduct.get(productId) ?? [];
    metadata.purchases[productId] = oneTimeProductFromWire(p, productOffers);
    if (logProgress) {
      const locales = (p.listings ?? []).length;
      const options = (p.purchaseOptions ?? []).length;
      const offers = productOffers.length;
      console.log(`  Exported one-time: ${productId} (${locales} locales, ${options} options, ${offers} offers)`);
    }
  }

  // -- Subscriptions + base plans + offers ----------------------------
  const subs = await client.listSubscriptions();
  if (subs.length > 0) {
    // One round-trip pulls every offer across the app — much cheaper
    // than walking sub × basePlan and listing per-pair.
    const allOffers = await client.listSubscriptionOffers('-', '-');
    const offersBySub = new Map<string, Schema$SubscriptionOfferSDK[]>();
    for (const o of allOffers) {
      const k = o.productId ?? '';
      if (!offersBySub.has(k)) offersBySub.set(k, []);
      offersBySub.get(k)!.push(o);
    }

    for (const s of subs) {
      const productId = s.productId;
      if (!productId) continue;
      const subOffers = offersBySub.get(productId) ?? [];
      metadata.subscriptions[productId] = subscriptionFromWire(s, subOffers);
      if (logProgress) {
        const planCount = s.basePlans?.length ?? 0;
        const offerCount = subOffers.length;
        const locales = (s.listings ?? []).length;
        console.log(`  Exported subscription: ${productId} (${locales} locales, ${planCount} plans, ${offerCount} offers)`);
      }
    }
  }

  return metadata;
}

// ============================================================================
// Command registration
// ============================================================================

export function registerIapCommands(program: Command): void {
  const iap = program
    .command('iap')
    .description('Manage one-time products, subscriptions, base plans, and offers');

  // ---- list -------------------------------------------------------------

  iap
    .command('list')
    .description('List every one-time product + subscription on Play')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const client = createClient(options.keyFile);

        const [products, subs] = await Promise.all([
          client.listOneTimeProducts(),
          client.listSubscriptions(),
        ]);

        console.log(chalk.bold(`\nOne-time products (${products.length}):\n`));
        if (products.length === 0) {
          console.log(chalk.gray('  (none)'));
        } else {
          for (const p of products) {
            const opts = p.purchaseOptions?.length ?? 0;
            const locales = (p.listings ?? []).length;
            const firstOpt = p.purchaseOptions?.[0];
            const firstPrice = firstOpt?.regionalPricingAndAvailabilityConfigs?.[0]?.price;
            const priceLabel = firstPrice
              ? `~${formatMoney(moneyFromWire(firstPrice)!)}`
              : chalk.gray('no price');
            console.log(`  ${chalk.cyan(p.productId ?? '?')}  ${opts} opts  ${locales} loc  ${priceLabel}`);
          }
        }

        console.log(chalk.bold(`\nSubscriptions (${subs.length}):\n`));
        if (subs.length === 0) {
          console.log(chalk.gray('  (none)'));
        } else {
          for (const s of subs) {
            const plans = s.basePlans?.length ?? 0;
            const locales = (s.listings ?? []).length;
            console.log(`  ${chalk.cyan(s.productId ?? '?')}  ${plans} plans  ${locales} loc`);
          }
        }
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- show -------------------------------------------------------------

  iap
    .command('show <productId>')
    .description('Show full state for one product (one-time product or subscription)')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (productId, options) => {
      try {
        const client = createClient(options.keyFile);

        // We don't know if productId is a one-time product or a
        // subscription up front — try both. Each getter returns null on
        // 404 (not throw), so the cascade is cheap.
        const oneTime = await client.getOneTimeProduct(productId);
        if (oneTime) {
          const offers = await client.listOneTimeProductOffers(productId, '-');
          renderOneTime(productId, oneTime, offers);
          return;
        }
        const sub = await client.getSubscription(productId);
        if (sub) {
          const offers = await client.listSubscriptionOffers(productId, '-');
          renderSubscription(productId, sub, offers);
          return;
        }
        console.error(chalk.red(`Not found on Play: ${productId}`));
        console.error(chalk.gray('Check the productId — `playstore iap list` shows everything.'));
        process.exit(1);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- sync -------------------------------------------------------------
  //
  // Reads the committed YAML (`l10n/metadata/play/iap.yaml`) and patches
  // each one-time product + subscription on Play to match. The default
  // path is the worktree-root committed YAML; --input lets you override
  // for ad-hoc files.
  //
  // What the patch covers (Phase 2):
  //   * one-time products: listings, purchase options (including
  //     new_regions + regional_configs + offer_tags). Purchase-option
  //     STATE is output-only on the wire — Play preserves it across
  //     patches; lifecycle (activate / deactivate) is a future phase.
  //   * subscriptions: listings, base plans (with prices + offer_tags).
  //     Base-plan state is output-only, same as above.
  //   * offers (one-time and subscription): NOT YET — handled in a
  //     follow-up phase via their dedicated sub-resources +
  //     activate/deactivate endpoints. Phase 2 leaves offers untouched.
  //
  // Each patch carries the live product's `regionsVersion` so the call
  // doesn't fail on stale-version errors after a Play-side region update.

  iap
    .command('sync')
    .description('Push YAML (l10n/metadata/play/iap.yaml) into Play — additive patches, preserves output-only state fields')
    .option('--input <path>', 'YAML file to read (defaults to l10n/metadata/play/iap.yaml)')
    .option('--product-id <productId>', 'Sync a single product only')
    .option('--regions-version <version>', 'Override Play regions catalog version (defaults to whatever Play returns on the first one-time product)')
    .option('--dry-run', 'Report what would be patched without making the calls')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { getWorktreeRoot } = await import('../auth.js');

        const yamlPath = options.input
          ?? join(getWorktreeRoot(), 'l10n', 'metadata', 'play', 'iap.yaml');
        if (!existsSync(yamlPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${yamlPath}`));
          console.error(chalk.yellow(`First-time setup? Run \`playstore iap export --output ${yamlPath}\` to seed it.`));
          process.exit(1);
        }

        const yamlState = parseYaml(readFileSync(yamlPath, 'utf-8')) as PlayIAPMetadata;
        const client = createClient(options.keyFile);
        const scope = options.productId as string | undefined;
        const dry = options.dryRun ?? false;

        // regionsVersion is required on every patch. One-time products
        // return it in the GET response; subscriptions don't. Resolve a
        // single shared default by pulling the first available one-time
        // product's version, falling back to the user override. (The
        // version string lives in Play's regions catalog — see
        // https://support.google.com/googleplay/android-developer/answer/10532353.)
        let defaultRegionsVersion = options.regionsVersion as string | undefined;
        if (!defaultRegionsVersion) {
          const firstOneTime = Object.keys(yamlState.purchases ?? {})[0];
          if (firstOneTime) {
            const sample = await client.getOneTimeProduct(firstOneTime);
            defaultRegionsVersion = (sample?.regionsVersion as any)?.version;
          }
        }
        if (!defaultRegionsVersion) {
          console.error(chalk.red('Could not resolve a regionsVersion. Pass --regions-version <version> (e.g. "2025/03").'));
          process.exit(1);
        }
        console.log(chalk.gray(`Using regionsVersion: ${defaultRegionsVersion}`));

        let synced = 0;
        let skipped = 0;

        // ---- one-time products ----
        for (const [productId, yamlProduct] of Object.entries(yamlState.purchases ?? {})) {
          if (scope && scope !== productId) continue;
          // Prefer the live product's own regionsVersion (in case it's
          // already on a newer one than our default); fall back to the
          // shared default for fresh products / read failures.
          const live = await client.getOneTimeProduct(productId);
          if (!live) {
            console.error(chalk.yellow(`  ! ${productId}: not on Play yet — skipping (will be picked up by Phase 3 \`iap create\`)`));
            skipped++;
            continue;
          }
          const regionsVersion = (live.regionsVersion as any)?.version ?? defaultRegionsVersion;
          const body = oneTimeProductToWire(yamlProduct);
          if (dry) {
            console.log(chalk.gray(`  [dry-run] one-time product: ${productId} (${body.listings?.length ?? 0} loc, ${body.purchaseOptions?.length ?? 0} opts)`));
          } else {
            await client.upsertOneTimeProduct(productId, body, regionsVersion);
            console.log(chalk.green(`  ✓ one-time product: ${productId}`));
          }
          synced++;
        }

        // ---- subscriptions ----
        for (const [productId, yamlSub] of Object.entries(yamlState.subscriptions ?? {})) {
          if (scope && scope !== productId) continue;
          const live = await client.getSubscription(productId);
          if (!live) {
            console.error(chalk.yellow(`  ! ${productId}: not on Play yet — skipping (will be picked up by Phase 3 \`iap create\`)`));
            skipped++;
            continue;
          }
          // Subscriptions don't carry regionsVersion in the response;
          // reuse the shared default resolved at the top of the command.
          const body = subscriptionToWire(yamlSub);
          if (dry) {
            console.log(chalk.gray(`  [dry-run] subscription: ${productId} (${body.listings?.length ?? 0} loc, ${body.basePlans?.length ?? 0} plans)`));
          } else {
            await client.upsertSubscription(productId, body, defaultRegionsVersion);
            console.log(chalk.green(`  ✓ subscription: ${productId}`));
          }
          synced++;
        }

        const verb = dry ? 'Would sync' : 'Synced';
        console.log(chalk.bold(`\n${verb} ${synced} product(s); skipped ${skipped}.`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- create -----------------------------------------------------------
  //
  // Provisions products that are in the YAML but missing from Play.
  // The inverse-skip of `iap sync` (which patches existing, skips
  // missing). One-time products go via `patch + allowMissing: true`
  // (Play's create surface for them); subscriptions go via the
  // dedicated `monetization.subscriptions.create` endpoint.
  //
  // Hard-fail policy: if any --product-id you've scoped to already
  // exists on Play, the command aborts with an error pointing you at
  // `iap sync` instead. This stops accidental clobbering of live
  // state's output-only fields (purchase-option state, etc.).
  //
  // Newly-created subscriptions land all their base plans + offers in
  // DRAFT state — they're not visible to users until activated via
  // the dedicated activate endpoints (Play's safety net so you don't
  // ship a half-configured tier). Activating those is a future phase.

  iap
    .command('create')
    .description('Create products that are in YAML but missing from Play (hard-fail on already-exists; use `iap sync` for that)')
    .option('--input <path>', 'YAML file to read (defaults to l10n/metadata/play/iap.yaml)')
    .option('--product-id <productId>', 'Create a single product only')
    .option('--regions-version <version>', 'Override Play regions catalog version')
    .option('--dry-run', 'Report what would be created without making the calls')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { getWorktreeRoot } = await import('../auth.js');

        const yamlPath = options.input
          ?? join(getWorktreeRoot(), 'l10n', 'metadata', 'play', 'iap.yaml');
        if (!existsSync(yamlPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${yamlPath}`));
          process.exit(1);
        }

        const yamlState = parseYaml(readFileSync(yamlPath, 'utf-8')) as PlayIAPMetadata;
        const client = createClient(options.keyFile);
        const scope = options.productId as string | undefined;
        const dry = options.dryRun ?? false;

        // Resolve a regionsVersion. We try an existing one-time
        // product first (which always carries it on GET); if there
        // are none, the user must pass --regions-version explicitly
        // since Play's docs don't expose a discovery endpoint for
        // "current catalog version" at a global level.
        let regionsVersion = options.regionsVersion as string | undefined;
        if (!regionsVersion) {
          for (const productId of Object.keys(yamlState.purchases ?? {})) {
            const sample = await client.getOneTimeProduct(productId);
            const v = (sample?.regionsVersion as any)?.version;
            if (v) { regionsVersion = v; break; }
          }
        }
        if (!regionsVersion) {
          console.error(chalk.red('Could not resolve a regionsVersion. Pass --regions-version <version> (e.g. "2025/03").'));
          process.exit(1);
        }
        console.log(chalk.gray(`Using regionsVersion: ${regionsVersion}`));

        // First pass: enumerate work + hard-fail on scope conflicts
        // (the scoped productId exists; pivot to `iap sync`).
        const toCreate: Array<{ kind: 'onetime' | 'sub'; productId: string }> = [];
        const conflicts: string[] = [];

        for (const productId of Object.keys(yamlState.purchases ?? {})) {
          if (scope && scope !== productId) continue;
          const live = await client.getOneTimeProduct(productId);
          if (live) {
            if (scope) conflicts.push(productId);
            continue;
          }
          toCreate.push({ kind: 'onetime', productId });
        }
        for (const productId of Object.keys(yamlState.subscriptions ?? {})) {
          if (scope && scope !== productId) continue;
          const live = await client.getSubscription(productId);
          if (live) {
            if (scope) conflicts.push(productId);
            continue;
          }
          toCreate.push({ kind: 'sub', productId });
        }

        if (conflicts.length > 0) {
          console.error(chalk.red(`The following product(s) already exist on Play — use \`iap sync\` to update them:`));
          for (const id of conflicts) console.error(chalk.red(`  - ${id}`));
          process.exit(1);
        }

        if (toCreate.length === 0) {
          console.log(chalk.gray('Nothing to create — every YAML product is already on Play.'));
          return;
        }

        // Second pass: actually create.
        for (const job of toCreate) {
          if (job.kind === 'onetime') {
            const body = oneTimeProductToWire(yamlState.purchases[job.productId]);
            if (dry) {
              console.log(chalk.gray(`  [dry-run] + one-time product: ${job.productId}`));
            } else {
              await client.upsertOneTimeProduct(job.productId, body, regionsVersion, { allowMissing: true });
              console.log(chalk.green(`  ✓ created one-time product: ${job.productId}`));
            }
          } else {
            const body = subscriptionToWire(yamlState.subscriptions[job.productId]);
            if (dry) {
              console.log(chalk.gray(`  [dry-run] + subscription: ${job.productId}`));
            } else {
              await client.createSubscription(job.productId, body, regionsVersion);
              console.log(chalk.green(`  ✓ created subscription: ${job.productId} (base plans land in DRAFT — activate via Play Console or future phase)`));
            }
          }
        }

        const verb = dry ? 'Would create' : 'Created';
        console.log(chalk.bold(`\n${verb} ${toCreate.length} product(s).`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- state ------------------------------------------------------------
  //
  // Reconciles the lifecycle state of base plans, subscription
  // offers, purchase options, and one-time offers against what the
  // YAML claims they should be. The `state` field on each is
  // output-only on `iap sync`'s patch — this command is the only way
  // to flip the live state from CLI.
  //
  // Quirks captured:
  //  * One-time PURCHASE OPTIONS don't have a single activate /
  //    deactivate — Play exposes only `batchUpdateStates`. The client
  //    method handles that; the command surfaces it as the same
  //    semantics as everything else.
  //  * `draft` is a starting state, not a target — newly-created
  //    resources land there and need an activate to ship. We never
  //    transition TO draft from CLI; if your YAML says `draft` we
  //    treat that as "leave alone".
  //  * `inactive` doesn't refund anyone — Play keeps existing
  //    subscribers entitled but hides the SKU from new purchasers.

  iap
    .command('state')
    .description('Reconcile live lifecycle state with YAML (activate/deactivate base plans, purchase options, offers)')
    .option('--input <path>', 'YAML file to read (defaults to l10n/metadata/play/iap.yaml)')
    .option('--product-id <productId>', 'Reconcile a single product only')
    .option('--dry-run', 'Report transitions without firing the calls')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { getWorktreeRoot } = await import('../auth.js');

        const yamlPath = options.input
          ?? join(getWorktreeRoot(), 'l10n', 'metadata', 'play', 'iap.yaml');
        if (!existsSync(yamlPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${yamlPath}`));
          process.exit(1);
        }

        const yamlState = parseYaml(readFileSync(yamlPath, 'utf-8')) as PlayIAPMetadata;
        const client = createClient(options.keyFile);
        const scope = options.productId as string | undefined;
        const dry = options.dryRun ?? false;

        // Compare current vs desired state. We only act when both are
        // unambiguous (active <-> inactive); `draft` means "don't
        // touch", same for missing entries.
        type Transition =
          | { kind: 'basePlan'; productId: string; basePlanId: string; to: 'ACTIVE' | 'INACTIVE' }
          | { kind: 'subOffer'; productId: string; basePlanId: string; offerId: string; to: 'ACTIVE' | 'INACTIVE' }
          | { kind: 'purchaseOption'; productId: string; purchaseOptionId: string; to: 'ACTIVE' | 'INACTIVE' }
          | { kind: 'oneTimeOffer'; productId: string; purchaseOptionId: string; offerId: string; to: 'ACTIVE' | 'INACTIVE' };
        const txns: Transition[] = [];

        const normaliseLiveState = (s: string | null | undefined): 'ACTIVE' | 'INACTIVE' | 'DRAFT' | undefined => {
          if (!s) return undefined;
          // Wire enums are upper-snake with a resource prefix
          // (e.g. BASE_PLAN_STATE_ACTIVE). Strip prefix, normalise.
          const tail = s.replace(/^[A-Z_]+STATE_/, '').replace(/^[A-Z_]+_STATE_/, '');
          if (tail === 'ACTIVE' || tail === 'INACTIVE' || tail === 'DRAFT') return tail;
          return undefined;
        };
        const desiredFromYaml = (s: string | undefined): 'ACTIVE' | 'INACTIVE' | undefined => {
          if (!s) return undefined;
          if (s === 'active') return 'ACTIVE';
          if (s === 'inactive') return 'INACTIVE';
          return undefined;
        };

        // --- subscriptions ---
        for (const [productId, yamlSub] of Object.entries(yamlState.subscriptions ?? {})) {
          if (scope && scope !== productId) continue;
          const live = await client.getSubscription(productId);
          if (!live) continue;
          const livePlans = new Map((live.basePlans ?? []).map((bp) => [bp.basePlanId ?? '', bp]));
          for (const yamlPlan of yamlSub.base_plans) {
            const desired = desiredFromYaml(yamlPlan.state);
            if (!desired) continue;
            const livePlan = livePlans.get(yamlPlan.base_plan_id);
            const liveState = normaliseLiveState(livePlan?.state);
            if (livePlan && liveState && liveState !== desired && liveState !== 'DRAFT') {
              txns.push({ kind: 'basePlan', productId, basePlanId: yamlPlan.base_plan_id, to: desired });
            }
          }
          // sub offers — pull all live offers for this product once
          const liveOffers = await client.listSubscriptionOffers(productId, '-');
          const liveOfferMap = new Map(liveOffers.map((o) => [`${o.basePlanId}/${o.offerId}`, o]));
          for (const yamlPlan of yamlSub.base_plans) {
            for (const yamlOffer of yamlPlan.offers ?? []) {
              const desired = desiredFromYaml(yamlOffer.state);
              if (!desired) continue;
              const live = liveOfferMap.get(`${yamlPlan.base_plan_id}/${yamlOffer.offer_id}`);
              const liveState = normaliseLiveState(live?.state);
              if (live && liveState && liveState !== desired && liveState !== 'DRAFT') {
                txns.push({
                  kind: 'subOffer', productId,
                  basePlanId: yamlPlan.base_plan_id,
                  offerId: yamlOffer.offer_id,
                  to: desired,
                });
              }
            }
          }
        }

        // --- one-time products ---
        for (const [productId, yamlProduct] of Object.entries(yamlState.purchases ?? {})) {
          if (scope && scope !== productId) continue;
          const live = await client.getOneTimeProduct(productId);
          if (!live) continue;
          const liveOptionMap = new Map((live.purchaseOptions ?? []).map((po) => [po.purchaseOptionId ?? '', po]));
          for (const yamlOpt of yamlProduct.purchase_options) {
            const desired = desiredFromYaml(yamlOpt.state);
            if (!desired) continue;
            const liveOpt = liveOptionMap.get(yamlOpt.purchase_option_id);
            const liveState = normaliseLiveState(liveOpt?.state);
            if (liveOpt && liveState && liveState !== desired && liveState !== 'DRAFT') {
              txns.push({
                kind: 'purchaseOption', productId,
                purchaseOptionId: yamlOpt.purchase_option_id, to: desired,
              });
            }
          }
          // one-time offers — pull all live offers for this product
          const liveOneTimeOffers = await client.listOneTimeProductOffers(productId, '-');
          const liveOneTimeOfferMap = new Map(liveOneTimeOffers.map((o) => [`${o.purchaseOptionId}/${o.offerId}`, o]));
          for (const yamlOpt of yamlProduct.purchase_options) {
            for (const yamlOffer of yamlOpt.offers ?? []) {
              const desired = desiredFromYaml(yamlOffer.state);
              if (!desired) continue;
              const live = liveOneTimeOfferMap.get(`${yamlOpt.purchase_option_id}/${yamlOffer.offer_id}`);
              const liveState = normaliseLiveState(live?.state);
              if (live && liveState && liveState !== desired && liveState !== 'DRAFT') {
                txns.push({
                  kind: 'oneTimeOffer', productId,
                  purchaseOptionId: yamlOpt.purchase_option_id,
                  offerId: yamlOffer.offer_id,
                  to: desired,
                });
              }
            }
          }
        }

        if (txns.length === 0) {
          console.log(chalk.gray('Live state already matches YAML — nothing to reconcile.'));
          return;
        }

        // Batch the purchase-option transitions by product (the only
        // path that requires batching). Everything else is per-item.
        const purchaseOptionBatches = new Map<string, Array<{ purchaseOptionId: string; state: 'ACTIVE' | 'INACTIVE' }>>();
        for (const t of txns) {
          if (t.kind === 'purchaseOption') {
            if (!purchaseOptionBatches.has(t.productId)) purchaseOptionBatches.set(t.productId, []);
            purchaseOptionBatches.get(t.productId)!.push({ purchaseOptionId: t.purchaseOptionId, state: t.to });
          }
        }

        for (const t of txns) {
          const arrow = `→ ${t.to === 'ACTIVE' ? chalk.green('active') : chalk.yellow('inactive')}`;
          const dryPrefix = dry ? chalk.gray('[dry-run] ') : '';
          if (t.kind === 'basePlan') {
            console.log(`  ${dryPrefix}base plan: ${t.productId}/${t.basePlanId} ${arrow}`);
            if (!dry) {
              if (t.to === 'ACTIVE') await client.activateBasePlan(t.productId, t.basePlanId);
              else await client.deactivateBasePlan(t.productId, t.basePlanId);
            }
          } else if (t.kind === 'subOffer') {
            console.log(`  ${dryPrefix}sub offer: ${t.productId}/${t.basePlanId}/${t.offerId} ${arrow}`);
            if (!dry) {
              if (t.to === 'ACTIVE') await client.activateSubscriptionOffer(t.productId, t.basePlanId, t.offerId);
              else await client.deactivateSubscriptionOffer(t.productId, t.basePlanId, t.offerId);
            }
          } else if (t.kind === 'oneTimeOffer') {
            console.log(`  ${dryPrefix}one-time offer: ${t.productId}/${t.purchaseOptionId}/${t.offerId} ${arrow}`);
            if (!dry) {
              if (t.to === 'ACTIVE') await client.activateOneTimeOffer(t.productId, t.purchaseOptionId, t.offerId);
              else await client.deactivateOneTimeOffer(t.productId, t.purchaseOptionId, t.offerId);
            }
          } else {
            // purchaseOption — log it; the actual call is batched below
            console.log(`  ${dryPrefix}purchase option: ${t.productId}/${t.purchaseOptionId} ${arrow}`);
          }
        }

        // Fire batched purchase-option transitions per product.
        if (!dry) {
          for (const [productId, transitions] of purchaseOptionBatches) {
            await client.setOneTimePurchaseOptionStates(productId, transitions);
          }
        }

        const verb = dry ? 'Would reconcile' : 'Reconciled';
        console.log(chalk.bold(`\n${verb} ${txns.length} state transition(s).`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- pull -------------------------------------------------------------
  //
  // Additive merge of live Play state into the committed YAML, the
  // reverse direction of `iap sync`. Uses the yaml Document API so
  // comments + key order are preserved; only fills gaps, never
  // overwrites existing local values. Mirrors the appstore-cli Phase 6
  // command of the same name.

  iap
    .command('pull')
    .description('Pull live Play state into the committed YAML — additive merge, preserves comments + local-only fields')
    .option('--product-id <productId>', 'Pull a single product / sub only')
    .option('--dry-run', 'Show what would be added/updated without writing')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { readFileSync, writeFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const { parseDocument } = await import('yaml');
        const { getWorktreeRoot } = await import('../auth.js');

        const yamlPath = join(getWorktreeRoot(), 'l10n', 'metadata', 'play', 'iap.yaml');
        if (!existsSync(yamlPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${yamlPath}`));
          console.error(chalk.yellow(`First-time setup? Run \`playstore iap export --output ${yamlPath}\` to seed it.`));
          process.exit(1);
        }

        const client = createClient(options.keyFile);
        console.log(chalk.blue('Pulling live Play state...'));
        const live = await fetchLiveIapState(client, false);

        const doc = parseDocument(readFileSync(yamlPath, 'utf-8'));
        const summary = mergeLiveIntoDocument(doc, live, options.productId, options.dryRun ?? false);

        if (!options.dryRun) {
          writeFileSync(yamlPath, String(doc));
          console.log(chalk.green(`\n✓ Merged into ${yamlPath}`));
        } else {
          console.log(chalk.yellow('\nDRY RUN — no file written.'));
        }
        console.log(`Products added: ${summary.added}`);
        console.log(`Products updated (gap-filled): ${summary.updated}`);
        console.log(`Locale slots filled: ${summary.localesAdded}`);
        console.log(`Options / base plans added: ${summary.optionsAdded}`);
        console.log(chalk.gray('(existing YAML values are never overwritten; use `iap export` for a full overwrite.)'));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- diff -------------------------------------------------------------

  iap
    .command('diff')
    .description('Show per-product divergence between the committed YAML and live Play (read-only)')
    .option('--product-id <productId>', 'Diff a single product only')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const { parse: parseYaml } = await import('yaml');
        const { getWorktreeRoot } = await import('../auth.js');

        const yamlPath = join(getWorktreeRoot(), 'l10n', 'metadata', 'play', 'iap.yaml');
        if (!existsSync(yamlPath)) {
          console.error(chalk.red(`IAP metadata file not found: ${yamlPath}`));
          process.exit(1);
        }

        const yamlState = parseYaml(readFileSync(yamlPath, 'utf-8')) as PlayIAPMetadata;
        const client = createClient(options.keyFile);
        console.log(chalk.blue('Diffing YAML vs live Play...\n'));
        const live = await fetchLiveIapState(client, false);

        diffPlayIapMetadata(yamlState, live, options.productId);
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // ---- export -----------------------------------------------------------

  iap
    .command('export')
    .description('Export full live IAP/subscription state to YAML — OVERWRITES the output file; use `iap pull` for surgical merges')
    .requiredOption('--output <path>', 'Output YAML file path')
    .option('--key-file <path>', 'Path to service account key file')
    .action(async (options) => {
      try {
        const { writeFileSync, mkdirSync, existsSync } = await import('fs');
        const { dirname } = await import('path');
        const { stringify } = await import('yaml');

        const client = createClient(options.keyFile);
        console.log(chalk.blue('Pulling live Play state...'));
        const metadata = await fetchLiveIapState(client, true);

        const outDir = dirname(options.output);
        if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
        const yamlBody = stringify(metadata, {
          defaultStringType: 'PLAIN',
          singleQuote: false,
          lineWidth: 0,
        });
        const header = '# In-App Purchase and Subscription Metadata (Google Play)\n'
          + '# Round-tripped via `playstore iap export`.\n\n';
        writeFileSync(options.output, header + yamlBody);

        console.log(chalk.green(`\n✓ Exported ${Object.keys(metadata.purchases).length} one-time products + ${Object.keys(metadata.subscriptions).length} subscriptions → ${options.output}`));
      } catch (error) {
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

// ============================================================================
// YAML Document merge (iap pull) — additive only, never overwrites
// ============================================================================
//
// yaml v2 API note: doc.get(key) returns the JS *value*; doc.get(key, true)
// returns the YAMLMap *node* we need to call .has() / .set() / .get() on.
// Always pass `true` here so we operate on nodes, not value snapshots.
// New sub-trees are inserted via doc.createNode(...) — passing a plain
// JS object to .set() works but produces YAMLMap nodes that look subtly
// off when re-serialised; createNode keeps formatting consistent.

interface MergeSummary {
  added: number;
  updated: number;
  localesAdded: number;
  optionsAdded: number;
}

function mergeLiveIntoDocument(
  doc: any,
  live: PlayIAPMetadata,
  scopedProductId: string | undefined,
  dryRun: boolean,
): MergeSummary {
  const sum: MergeSummary = { added: 0, updated: 0, localesAdded: 0, optionsAdded: 0 };
  const matchesScope = (id: string) => !scopedProductId || scopedProductId === id;

  for (const top of ['purchases', 'subscriptions']) {
    if (!doc.has(top)) doc.set(top, doc.createNode({}));
  }

  // -- one-time products --------------------------------------------
  const purchasesNode = doc.get('purchases', true);
  for (const [productId, liveProduct] of Object.entries(live.purchases)) {
    if (!matchesScope(productId)) continue;
    if (!purchasesNode.has(productId)) {
      console.log(chalk.green(`+ purchase: ${productId}`));
      if (!dryRun) purchasesNode.set(productId, doc.createNode(liveProduct));
      sum.added++;
    } else {
      const before = { localesAdded: sum.localesAdded, optionsAdded: sum.optionsAdded };
      const yamlEntry = purchasesNode.get(productId, true);
      mergeYamlListings(doc, yamlEntry, liveProduct.listings, dryRun, `purchases/${productId}`, (n) => { sum.localesAdded += n; });
      mergeYamlArrayById(
        doc, yamlEntry, 'purchase_options',
        liveProduct.purchase_options,
        (item) => item.purchase_option_id,
        dryRun, `purchases/${productId}/purchase_options`,
        (n) => { sum.optionsAdded += n; },
      );
      mergeYamlEntryFields(doc, yamlEntry, liveProduct, ['offer_tags'], dryRun, `purchases/${productId}`);
      if (sum.localesAdded !== before.localesAdded || sum.optionsAdded !== before.optionsAdded) sum.updated++;
    }
  }

  // -- subscriptions ------------------------------------------------
  const subsNode = doc.get('subscriptions', true);
  for (const [productId, liveSub] of Object.entries(live.subscriptions)) {
    if (!matchesScope(productId)) continue;
    if (!subsNode.has(productId)) {
      console.log(chalk.green(`+ subscription: ${productId}`));
      if (!dryRun) subsNode.set(productId, doc.createNode(liveSub));
      sum.added++;
    } else {
      const before = { localesAdded: sum.localesAdded, optionsAdded: sum.optionsAdded };
      const yamlEntry = subsNode.get(productId, true);
      mergeYamlListings(doc, yamlEntry, liveSub.listings, dryRun, `subscriptions/${productId}`, (n) => { sum.localesAdded += n; });
      mergeYamlArrayById(
        doc, yamlEntry, 'base_plans',
        liveSub.base_plans,
        (item) => item.base_plan_id,
        dryRun, `subscriptions/${productId}/base_plans`,
        (n) => { sum.optionsAdded += n; },
      );
      if (sum.localesAdded !== before.localesAdded || sum.optionsAdded !== before.optionsAdded) sum.updated++;
    }
  }

  return sum;
}

/** Fill missing top-level scalar/map fields on a YAML entry from a
 *  live JS object. Existing values are never touched. */
function mergeYamlEntryFields(
  doc: any,
  yamlEntry: any,
  liveEntry: Record<string, any>,
  fields: string[],
  dryRun: boolean,
  pathLabel: string,
): void {
  for (const field of fields) {
    const liveVal = (liveEntry as any)[field];
    if (liveVal === undefined) continue;
    if (yamlEntry.has(field)) continue;
    console.log(chalk.green(`+ ${pathLabel}/${field}`));
    if (!dryRun) yamlEntry.set(field, doc.createNode(liveVal));
  }
}

/** Union live listings (locale-keyed map) into a YAML entry. Each
 *  locale either matches an existing key (no-op) or gets appended. */
function mergeYamlListings(
  doc: any,
  yamlEntry: any,
  liveLocs: Record<string, PlayListing> | undefined,
  dryRun: boolean,
  pathLabel: string,
  onAdded: (count: number) => void,
): void {
  if (!liveLocs || Object.keys(liveLocs).length === 0) return;
  let yamlLocs = yamlEntry.get('listings', true);
  for (const [lang, loc] of Object.entries(liveLocs)) {
    if (!yamlLocs) {
      console.log(chalk.green(`+ ${pathLabel}/listings`));
      if (!dryRun) {
        yamlEntry.set('listings', doc.createNode({ [lang]: loc }));
        yamlLocs = yamlEntry.get('listings', true);
      }
      onAdded(1);
      continue;
    }
    if (!yamlLocs.has(lang)) {
      console.log(chalk.green(`+ ${pathLabel}/listings/${lang}`));
      if (!dryRun) yamlLocs.set(lang, doc.createNode(loc));
      onAdded(1);
    }
  }
}

/** Union a live array onto an array field, matched by an id getter
 *  (e.g. purchase_option_id, base_plan_id, region). Items present in
 *  YAML by their id are left as-is; new ids are appended. */
function mergeYamlArrayById<T>(
  doc: any,
  yamlEntry: any,
  field: string,
  liveItems: T[] | undefined,
  idOf: (item: T) => string,
  dryRun: boolean,
  pathLabel: string,
  onAdded: (count: number) => void,
): void {
  if (!liveItems || liveItems.length === 0) return;
  let yamlSeq = yamlEntry.get(field, true);
  if (!yamlSeq) {
    if (!dryRun) {
      yamlEntry.set(field, doc.createNode(liveItems));
      yamlSeq = yamlEntry.get(field, true);
    }
    console.log(chalk.green(`+ ${pathLabel} (${liveItems.length} item${liveItems.length === 1 ? '' : 's'})`));
    onAdded(liveItems.length);
    return;
  }
  // Collect existing ids by scanning the sequence's items.
  const haveIds = new Set<string>();
  for (const item of (yamlSeq.items ?? []) as any[]) {
    // Each item is a YAMLMap; its toJS() pulls just the id field.
    const id = item?.get?.(field === 'purchase_options' ? 'purchase_option_id'
      : field === 'base_plans' ? 'base_plan_id'
        : 'region');
    if (typeof id === 'string') haveIds.add(id);
  }
  for (const liveItem of liveItems) {
    const id = idOf(liveItem);
    if (haveIds.has(id)) continue;
    console.log(chalk.green(`+ ${pathLabel}/${id}`));
    if (!dryRun) yamlSeq.add(doc.createNode(liveItem));
    onAdded(1);
  }
}

// ============================================================================
// iap diff — read-only divergence report
// ============================================================================
//
// Product-level granularity. Listings + per-region pricing diffs are out
// of scope for Phase 4 — the right primitive for that would be a
// canonicaliser that normalises both sides to the same shape, then a
// recursive walk. We can stack that on later if it earns its keep; for
// now `local-only / live-only` is enough to drive `iap pull` vs `iap
// sync` decisions.

function diffPlayIapMetadata(
  yamlState: PlayIAPMetadata,
  live: PlayIAPMetadata,
  scopedProductId: string | undefined,
): void {
  const matchesScope = (id: string) => !scopedProductId || scopedProductId === id;
  const rows: Array<{ category: string; path: string }> = [];

  const yamlPurchaseIds = new Set(Object.keys(yamlState.purchases ?? {}));
  const livePurchaseIds = new Set(Object.keys(live.purchases ?? {}));
  for (const id of yamlPurchaseIds) {
    if (!matchesScope(id)) continue;
    if (!livePurchaseIds.has(id)) rows.push({ category: 'local-only', path: `purchases/${id}` });
  }
  for (const id of livePurchaseIds) {
    if (!matchesScope(id)) continue;
    if (!yamlPurchaseIds.has(id)) rows.push({ category: 'live-only', path: `purchases/${id}` });
  }

  const yamlSubIds = new Set(Object.keys(yamlState.subscriptions ?? {}));
  const liveSubIds = new Set(Object.keys(live.subscriptions ?? {}));
  for (const id of yamlSubIds) {
    if (!matchesScope(id)) continue;
    if (!liveSubIds.has(id)) rows.push({ category: 'local-only', path: `subscriptions/${id}` });
  }
  for (const id of liveSubIds) {
    if (!matchesScope(id)) continue;
    if (!yamlSubIds.has(id)) rows.push({ category: 'live-only', path: `subscriptions/${id}` });
  }

  if (rows.length === 0) {
    console.log(chalk.green('No divergence detected — YAML and live Play match.'));
    return;
  }

  rows.sort((a, b) => a.path.localeCompare(b.path));
  for (const row of rows) {
    const colour = row.category === 'local-only' ? chalk.yellow : chalk.cyan;
    console.log(`  ${colour(row.category.padEnd(11))} ${row.path}`);
  }
  console.log(chalk.bold(`\n${rows.length} divergence(s).`));
  console.log(chalk.gray('  • local-only → run `iap sync` to push it'));
  console.log(chalk.gray('  • live-only  → run `iap pull` to absorb it'));
}

// ============================================================================
// Renderers (text display, not YAML — for `iap show`)
// ============================================================================

function renderOneTime(
  productId: string,
  p: Schema$OneTimeProduct,
  offers: Schema$OneTimeProductOffer[],
): void {
  console.log(chalk.bold(`\nOne-time product: ${chalk.cyan(productId)}\n`));

  const locs = p.listings ?? [];
  console.log(chalk.bold(`  Localisations (${locs.length}):`));
  for (const l of locs) {
    console.log(`    ${chalk.cyan(l.languageCode ?? '?')}: ${l.title ?? ''}`);
    if (l.description) console.log(`      ${chalk.gray(truncate(l.description, 80))}`);
  }

  const opts = p.purchaseOptions ?? [];
  console.log(chalk.bold(`\n  Purchase options (${opts.length}):`));
  for (const po of opts) {
    const state = po.state === 'ACTIVE' ? chalk.green('active') : chalk.yellow(po.state ?? '?');
    const kind = po.buyOption ? 'buy' : po.rentOption ? 'rent' : 'other';
    const legacyTag = po.buyOption?.legacyCompatible ? chalk.gray(' (legacy-compatible)') : '';
    console.log(`    ${chalk.cyan(po.purchaseOptionId ?? '?')}  ${kind}  ${state}${legacyTag}`);

    if (po.newRegionsConfig?.usdPrice && po.newRegionsConfig?.eurPrice) {
      console.log(`      new regions: USD ${formatMoney(moneyFromWire(po.newRegionsConfig.usdPrice)!)} / EUR ${formatMoney(moneyFromWire(po.newRegionsConfig.eurPrice)!)}`);
    }
    const rc = po.regionalPricingAndAvailabilityConfigs ?? [];
    if (rc.length > 0) {
      console.log(`      regional prices: ${rc.length} regions`);
      for (const r of rc.slice(0, 5)) {
        if (r.price) console.log(`        ${r.regionCode}: ${formatMoney(moneyFromWire(r.price)!)}`);
      }
      if (rc.length > 5) console.log(chalk.gray(`        … and ${rc.length - 5} more`));
    }

    const optionOffers = offers.filter((o) => o.purchaseOptionId === po.purchaseOptionId);
    if (optionOffers.length > 0) {
      console.log(chalk.bold(`      offers (${optionOffers.length}):`));
      for (const o of optionOffers) {
        const offerState = o.state === 'ACTIVE' ? chalk.green('active') : chalk.yellow(o.state ?? '?');
        const kind = o.discountedOffer ? 'discounted' : o.preOrderOffer ? 'pre-order' : 'other';
        console.log(`        ${chalk.cyan(o.offerId ?? '?')}  ${offerState}  ${kind}`);
      }
    }
  }
}

function renderSubscription(
  productId: string,
  s: Schema$Subscription,
  offers: Schema$SubscriptionOfferSDK[],
): void {
  console.log(chalk.bold(`\nSubscription: ${chalk.cyan(productId)}\n`));

  const locs = s.listings ?? [];
  console.log(chalk.bold(`  Localisations (${locs.length}):`));
  for (const l of locs) {
    console.log(`    ${chalk.cyan(l.languageCode ?? '?')}: ${l.title ?? ''}`);
    if (l.description) console.log(`      ${chalk.gray(truncate(l.description, 80))}`);
    if (l.benefits && l.benefits.length > 0) {
      console.log(`      benefits: ${l.benefits.map((b) => `"${b}"`).join(', ')}`);
    }
  }

  const plans = s.basePlans ?? [];
  console.log(chalk.bold(`\n  Base plans (${plans.length}):`));
  for (const bp of plans) {
    const state = bp.state === 'ACTIVE' ? chalk.green('active') : chalk.yellow(bp.state ?? '?');
    const billing = bp.autoRenewingBasePlanType?.billingPeriodDuration
      ?? bp.prepaidBasePlanType?.billingPeriodDuration
      ?? '?';
    const kind = bp.autoRenewingBasePlanType ? 'auto-renew' : bp.prepaidBasePlanType ? 'prepaid' : 'other';
    console.log(`    ${chalk.cyan(bp.basePlanId ?? '?')}  ${kind} ${billing}  ${state}`);

    if (bp.otherRegionsConfig?.usdPrice && bp.otherRegionsConfig?.eurPrice) {
      console.log(`      other regions: USD ${formatMoney(moneyFromWire(bp.otherRegionsConfig.usdPrice)!)} / EUR ${formatMoney(moneyFromWire(bp.otherRegionsConfig.eurPrice)!)}`);
    }
    const rc = bp.regionalConfigs ?? [];
    if (rc.length > 0) {
      console.log(`      regional prices: ${rc.length} regions`);
      for (const r of rc.slice(0, 5)) {
        if (r.price) console.log(`        ${r.regionCode}: ${formatMoney(moneyFromWire(r.price)!)}`);
      }
      if (rc.length > 5) console.log(chalk.gray(`        … and ${rc.length - 5} more`));
    }

    const planOffers = offers.filter((o) => o.basePlanId === bp.basePlanId);
    if (planOffers.length > 0) {
      console.log(chalk.bold(`      offers (${planOffers.length}):`));
      for (const o of planOffers) {
        const offerState = o.state === 'ACTIVE' ? chalk.green('active') : chalk.yellow(o.state ?? '?');
        const phaseDesc = (o.phases ?? []).map(describeSubPhase).join(' → ');
        console.log(`        ${chalk.cyan(o.offerId ?? '?')}  ${offerState}  ${phaseDesc}`);
      }
    }
  }
}

function describeSubPhase(ph: androidpublisher_v3.Schema$SubscriptionOfferPhase): string {
  const rc = ph.regionalConfigs?.[0];
  const treatment = rc?.free
    ? 'free'
    : rc?.price
      ? formatMoney(moneyFromWire(rc.price)!)
      : rc?.absoluteDiscount
        ? `−${formatMoney(moneyFromWire(rc.absoluteDiscount)!)}`
        : rc?.relativeDiscount != null
          ? `${Math.round(rc.relativeDiscount * 100)}% off`
          : '?';
  return `${ph.duration ?? '?'} × ${ph.recurrenceCount ?? '?'} (${treatment})`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + '…';
}
