# `iap.yaml` schema

The full YAML format for `iap.yaml`. Covers one-time products (managed products), subscriptions, base plans, offers, and the regional pricing structures.

## Top-level shape

```yaml
purchases:                    # one-time products (managed; non-consumable mostly)
  <product_id>:
    listings:
      <lang>:
        title: <string>
        description: <string>
    purchase_options:
      - purchase_option_id: <string>
        state: active | inactive | draft
        buy:                  # OR rent: { ... }
          legacy_compatible: <bool>
          multi_quantity_enabled: <bool>
        new_regions:
          usd_price: { currency_code: USD, units: <int>, nanos: <int> }
          eur_price: { currency_code: EUR, units: <int>, nanos: <int> }
          availability: available
        regional_configs:
          - region: US        # ISO-2
            price: { currency_code: USD, units: 4, nanos: 990000000 }
            availability: available
        offer_tags: [<tag>, ...]
        offers:               # optional, on-sale / pre-order treatments
          - offer_id: <string>
            state: active | inactive | draft
            offer_tags: [<tag>, ...]
            discounted: { start_time: ..., end_time: ..., redemption_limit: ... }
            # OR: pre_order: { end_time, expected_release_time, price_change_behavior }
            regional_configs:
              - region: US
                availability: available
                absolute_discount: { currency_code: USD, units: 1, nanos: 0 }
                # OR: relative_discount: 0.5  (50% off)
                # OR: no_override: true       (use the purchase-option price as-is)
    offer_tags: [<tag>, ...]  # product-level tags

subscriptions:                # auto-renewing via monetization.subscriptions
  <product_id>:
    listings:
      <lang>:
        title: <string>
        description: <string>
        benefits: [<string>, ...]   # up to 4, shown on the Play sub sheet
    base_plans:
      - base_plan_id: <string>
        state: active | inactive | draft
        auto_renewing:              # OR prepaid: { billing_period }
          billing_period: P1W | P1M | P3M | P6M | P1Y
          grace_period:  P0D | P3D | P7D | P14D | P30D
          legacy_compatible: <bool>
        other_regions:              # USD/EUR fallback for new regions Play opens
          usd_price: { currency_code: USD, units: <int>, nanos: <int> }
          eur_price: { currency_code: EUR, units: <int>, nanos: <int> }
          new_subscriber_availability: <bool>
        regional_configs:
          - region: US
            price: { currency_code: USD, units: 4, nanos: 990000000 }
            new_subscriber_availability: <bool>
        offer_tags: [<tag>, ...]
        offers:                     # intro offers, retention, promo, code-redemption
          - offer_id: <string>
            state: active | inactive | draft
            offer_tags: [<tag>, ...]
            targeting: { new_subscriber: <bool>, upgrade: <bool> }
            phases:
              - duration: P7D | P1M | P1Y | ...
                recurrence_count: <int>
                free: true          # OR one of:
                price: { currency_code: USD, units: 1, nanos: 990000000 }
                absolute_discount: { ... }
                relative_discount: 0.5
```

## Field reference — one-time products

| Field | Notes |
|---|---|
| `listings` | Map of BCP-47 lang code → `{ title, description }`. `title` ≤ 55 chars, `description` ≤ 200 |
| `purchase_options[]` | Almost always one entry. Multiple is rare (buy + rent variants, tiered SKUs) |
| `purchase_option_id` | Unique within the product. Immutable |
| `state` | Output-only on patch — change via `iap state` |
| `buy.legacy_compatible` | Marks this option as the one returned by deprecated PBL queries. Only one per product |
| `new_regions.usd_price` + `eur_price` | Required when `new_regions` is present. Used for any region Play opens in future |
| `regional_configs[].region` | ISO-2 alpha-2 code |
| `regional_configs[].price.currency_code` | Must match the region's local currency (Play enforces) |

## Field reference — subscriptions

| Field | Notes |
|---|---|
| `listings.<lang>.benefits[]` | Up to 4 short strings, shown on the Play subscription sheet. Plain text |
| `base_plans[]` | Multiple plans support upgrade ladders |
| `base_plan_id` | Unique within the subscription. Immutable |
| `auto_renewing` OR `prepaid` | Pick exactly one (mutually exclusive billing types) |
| `billing_period` | ISO 8601 duration. Limited to `P1W`, `P1M`, `P3M`, `P6M`, `P1Y` |
| `grace_period` | Optional. `P0D` / `P3D` / `P7D` / `P14D` / `P30D` |
| `other_regions` | USD + EUR fallback for new regions Play opens |
| `regional_configs[].price` | Per-region in local currency. Required for `new_subscriber_availability: true` |

## Offers

Offers attach to a base plan (sub) or purchase option (one-time). The split:

### Subscription offers

Multi-phase pricing ladder. Each phase is a duration + a treatment (`free`, `price`, `absolute_discount`, or `relative_discount`). Phases run in order; the offer ends when the last phase completes.

```yaml
offers:
  - offer_id: welcome-trial
    state: active
    targeting: { new_subscriber: true }
    phases:
      - duration: P7D
        recurrence_count: 1
        free: true               # 7 days free
      - duration: P1M
        recurrence_count: 3
        price: { currency_code: USD, units: 1, nanos: 990000000 }   # then $1.99/mo for 3 months
```

### One-time offers

Either a discounted offer (limited-time discount on the purchase) or a pre-order. **Cannot set a flat price** — only discount the purchase-option price.

```yaml
offers:
  - offer_id: launch-50
    state: active
    discounted:
      start_time: 2026-01-01T00:00:00Z
      end_time:   2026-01-31T23:59:59Z
      redemption_limit: 1000     # 0 / omitted = unlimited
    regional_configs:
      - region: US
        availability: available
        relative_discount: 0.5   # 50% off
      - region: GB
        availability: available
        absolute_discount: { currency_code: GBP, units: 2, nanos: 0 }
```

## Pricing model

Play's pricing is **concrete per region**, not anchor + tier like Apple. Each `regional_configs` entry sets an explicit price in the region's local currency. The `new_regions` (one-time) or `other_regions` (subscriptions) block provides USD + EUR fallbacks for any region Play opens in future that's not in `regional_configs`.

### Money values

```yaml
price:
  currency_code: USD
  units: 4               # whole-currency part
  nanos: 990000000       # fractional, in 10^-9
# → $4.99
```

The wire ships `units` as a string (the API permits values >2^53); the CLI accepts it as a number in YAML for readability and coerces on the way out.

### Region codes

ISO 3166-1 alpha-2: `US`, `GB`, `DE`, `FR`, `JP`, etc.

Play enforces `currency_code` matches the region's local currency — `regional_configs: [{ region: GB, price: { currency_code: USD, ... } }]` will be rejected. The CLI doesn't validate client-side; the API will surface the error.

## State lifecycle

Every state-bearing entity (`purchase_options`, `base_plans`, `offers`) carries a `state` field. **Output-only on patch**: `iap sync` ignores it; `iap state` reconciles it via dedicated activate/deactivate endpoints.

`draft` is a starting state for newly-created resources. You don't transition TO draft from CLI; if YAML says `draft`, `iap state` leaves it alone.

## Round-trip fidelity

`iap export` → `iap sync` is a no-op (zero divergence in `iap diff`). The exporter writes every field the syncer can push back. If you find a roundtrip that drifts, it's a bug.

## What's NOT in this schema

- **Subscription groups** — Play doesn't have them. Each subscription stands alone.
- **Review screenshots** — Play doesn't require them like Apple does.
- **`family_sharable`** — not a Play concept.
- **Tier price points** — Play uses concrete prices, no tier table.
