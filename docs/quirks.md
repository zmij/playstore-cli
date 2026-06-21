# Play quirks

Non-obvious behaviour from the Google Play Developer API that the CLI works around. Each entry includes what the API does, what we do about it, and what to remember when you go beyond the CLI.

## 1. Legacy `inappproducts` API is dead

For newer accounts, the legacy `inappproducts` resource (managed products via the pre-2023 API) returns **403 "Please migrate to the new publishing API"** on every call. The CLI uses `monetization.onetimeproducts` exclusively — the new API surface introduced in 2023.

This required upgrading `googleapis` to ≥ 173.0.0 to get the `monetization.onetimeproducts` resource class.

If you're reading old documentation or example code that uses `inappproducts.list()`, ignore it. The replacement is:

- `monetization.onetimeproducts.list()`
- `monetization.onetimeproducts.get(productId)`
- `monetization.onetimeproducts.patch(productId, body, regionsVersion, allowMissing)`
- `monetization.onetimeproducts.purchaseOptions.batchUpdateStates()`
- `monetization.onetimeproducts.purchaseOptions.offers.{activate, deactivate, list}`

## 2. Pricing is concrete per region, not anchor + tier

Where Apple has a tier table you reference by ID, Play takes a literal `Money { currency_code, units, nanos }` per region. There's no "auto-equalise" mechanism beyond `newRegionsConfig` (USD + EUR fallback for any region Play opens in future that's not already in your `regionalConfigs`).

This means a price change in YAML usually means editing many `regional_configs` entries — `iap export` writes them all explicitly. The deep-diff walker matches by `region` so reordering doesn't register as drift.

Currency must match the region's local currency. `regional_configs: [{ region: GB, price: { currency_code: USD, ... } }]` is rejected by Play.

## 3. Region codes are ISO-2

`US`, `DE`, `GB`, `FR`, `JP` — not `USA`, `DEU`, `GBR` like Apple. If you're cross-porting from appstore-cli YAML, you'll need to map.

## 4. No subscription groups

Apple has `subscription_groups` (a sub belongs to a group; users can only have one sub per group at a time). Play has no such concept — each subscription stands alone. The YAML schema has no `subscription_groups` top-level.

If you're migrating logic from Apple, upgrade ladders are implemented via **multiple base plans** within one subscription instead.

## 5. One-time PURCHASE OPTIONS have no single activate/deactivate

Sub base plans, sub offers, and one-time offers all have dedicated `activate` / `deactivate` endpoints. **One-time purchase options don't.** The only state-transition endpoint Play exposes is `monetization.onetimeproducts.purchaseOptions.batchUpdateStates`, which takes an array.

The CLI's `iap state` handles batching transparently — you specify the YAML state and it figures out the right call. Don't try to flip a one-time purchase option's state with a per-item call; it doesn't exist.

## 6. `regionsVersion` is required on every patch

Play's regional catalogue evolves (new countries, currency tweaks). Every `patch` and `create` requires you to declare which catalogue version you're targeting via `regionsVersion.version`, like `"2025/03"`.

Quirk: **one-time products return this in the GET response, but subscriptions don't**. The CLI's sync command resolves a shared default at startup by GETting the first YAML-listed one-time product, then uses that version for subscription patches too. `--regions-version` overrides.

## 7. Newly-created subscriptions land in DRAFT

When `iap create` creates a new subscription, every base plan and every offer on it lands in `DRAFT` state. They're **invisible to users** until you activate them.

The success message reminds you. Use `iap state` to flip them, or use Play Console for the manual flip.

This is Play's safety net — you can't accidentally ship a half-configured tier. Apple has no equivalent.

## 8. `updateMask: '*'` is rejected

Google's standard field-mask syntax accepts `*` as "all fields", but the Play monetization API specifically does NOT. You must enumerate the fields you want to update.

The CLI's default updateMasks:

- One-time products: `listings,purchaseOptions,offerTags`
- Subscriptions: `listings,basePlans`

If you add a new top-level field to the YAML schema, you must also add it to the updateMask string in `src/client.ts` `upsertOneTimeProduct` / `upsertSubscription`, or the field will be ignored on push.

## 9. One-time offers can't set a flat price

Subscription offer phases support `free`, `price`, `absolute_discount`, OR `relative_discount`. One-time offers support only `absolute_discount`, `relative_discount`, OR `no_override`. **No flat-price override.**

The YAML schema reflects this: one-time `offers[].regional_configs[]` doesn't accept `price`. Setting one in YAML will produce a typecheck error.

## 10. Two price shapes on the wire

The new monetization API uses `Schema$Money { currencyCode, units, nanos }`. The dead-but-still-typed `inappproducts` API uses `Schema$Price { currency, priceMicros }`. Don't accidentally re-introduce the legacy shape — `client.ts` canonicalises everything to `Money` because that's what the monetization API speaks.

If you see `priceMicros` in code, it's old or wrong.

## 11. `client.deleteEdit()` after every read-only edit-session call

Some Play endpoints (listings, tracks, images) require an edit session: you start an edit, do work, then either commit or delete. The CLI's read commands start an edit implicitly when needed (`listListings`, `listTracks`, `listScreenshots`).

**If the read path doesn't commit, you must `deleteEdit()` afterwards.** Otherwise the edit accumulates as a pending change in Play Console, visible to other operators. The MCP server does this religiously after every read; the CLI mostly doesn't because each command run is short and the edit gets garbage-collected by Play after a while — but it's still good hygiene.

## 12. Worktree vs project root

Same setup as appstore-cli:

- **Project root** — the main repo. Where secrets live (`.secret-stuff/playstore-config.yaml`). Shared across worktrees.
- **Worktree root** — the current branch's working directory. Where metadata lives. Per-branch.

If you're not using worktrees, both roots are the same — nothing to think about.

## 13. The historical metadata split

This is a Lazy-Sudoku-specific quirk preserved by the defaults: IAP YAML lives at `l10n/metadata/play/iap.yaml`, but listings + screenshots + release notes live at `l10n/metadata/google/...`. The CLI has separate `metadata_dir` and `listings_dir` knobs because of this.

Greenfield projects should set both to the same directory in `playstore-cli.config.yaml`:

```yaml
metadata_dir: store-metadata/play
listings_dir: store-metadata/play   # unify
```

When this package is extracted to its own repo, consider flipping the default so `listings_dir` matches `metadata_dir` and the split is a downstream override rather than the default.
