# Workflow

The CLI exists to make Play Console editable from text files instead of a website. The canonical loop is **export → edit → sync**, with **pull** + **diff** filling in two-way reconciliation, and **state** + **migrate-prices** handling the things `sync` deliberately doesn't touch.

## The core loop (IAPs + subscriptions)

```bash
# One-time: seed the YAML from live Play.
playstore iap export --output l10n/metadata/play/iap.yaml
git add l10n/metadata/play/iap.yaml && git commit -m "seed: iap metadata"

# Day-to-day: edit YAML, push.
$EDITOR l10n/metadata/play/iap.yaml
playstore iap sync --dry-run                # safe preview
playstore iap sync                          # push for real
git commit -am "Update IAP copy for v1.2"

# When someone edits Play Console directly:
playstore iap diff                          # show what drifted
playstore iap pull                          # absorb live changes without overwriting local
git diff l10n/metadata/play/iap.yaml        # review what came in
```

## What `iap sync` does and doesn't touch

`sync` patches **content + pricing** for existing products:

- Listings (per-language `display_name` + `description`)
- Purchase options + their `regional_configs` + `new_regions` fallback
- Base plans + their regional configs
- Offer tags

It does NOT touch:

- **State** (`ACTIVE` / `INACTIVE` / `DRAFT`) — output-only on the patch. Use `iap state`.
- **Existing subscriber pricing** — patching writes the new price for new subscribers only. Use `iap migrate-prices` for the rest.
- **Offers** themselves (creating new offers via sync isn't supported yet — coming in a follow-up).

This separation is intentional: state changes affect store visibility, price migrations affect billing, and offer creation has user-impact implications. Each gets its own verb.

## Creating new products

`iap sync` only patches existing products; it skips missing ones with a yellow warning. To create:

```bash
# Add new entries to iap.yaml
$EDITOR l10n/metadata/play/iap.yaml

# Pre-flight: does Play think this productId is taken?
playstore iap create --product-id premium_yearly --dry-run

# Actually create. Hard-fails if the productId already exists (use sync instead).
playstore iap create --product-id premium_yearly
```

Newly-created subscriptions land their base plans + offers in **DRAFT** state — they're invisible to users until you activate them:

```bash
# Flip them ACTIVE
playstore iap state --product-id premium_yearly
```

(Or use Play Console for the manual flip.)

## Lifecycle (state)

Reconcile YAML's `state:` fields with what's live on Play:

```bash
# Inspect — finds where YAML says one thing and live says another
playstore iap state --dry-run

# Apply
playstore iap state
```

The command walks every base plan, subscription offer, one-time offer, and purchase option and routes each transition to the right endpoint:

- Base plans, sub offers, one-time offers → individual activate/deactivate calls.
- One-time **purchase options** → batched per parent product (Play has no single-option lifecycle endpoint).

`yaml.state = draft` is treated as "leave alone" — you don't transition TO draft from CLI.

## Pricing migration

Patch operations make new prices apply to **new** subscribers only. Existing subscribers stay on their old cohort price.

```bash
# Scope: ONE subscription + ONE base plan + a region list per invocation.
playstore iap migrate-prices \
  --product-id premium_monthly \
  --base-plan-id premium-monthly \
  --regions US,GB,DE \
  --dry-run

# Or all priced regions on this plan:
playstore iap migrate-prices \
  --product-id premium_monthly \
  --base-plan-id premium-monthly \
  --regions all \
  --cutoff 2025-01-01T00:00:00Z \
  --increase-type PRICE_INCREASE_TYPE_OPT_IN
```

`--cutoff` defaults to **now** (every existing cohort migrates). Pass an earlier ISO timestamp to preserve a recent cohort. `--increase-type` is optional — omit for Play's default (typically opt-in for increases, auto-apply for decreases).

Single-purpose by design — no auto-fan-out across products, no YAML-drift auto-detection. Price migrations have user impact (billing notifications, opt-in flows) and the operator picks each plan deliberately.

## Two-way reconciliation

```bash
playstore iap diff                          # what differs
playstore iap pull --dry-run                # what `pull` would absorb
playstore iap pull                          # absorb (additive only)
git diff l10n/metadata/play/iap.yaml        # commit if it looks right
```

`pull` is **additive only**. If a product exists in both YAML and live but their fields differ, `pull` leaves the YAML alone — you decide:

- `iap sync` → YAML wins (overwrites live)
- Hand-edit YAML to match live, then `pull` is a no-op

## Listings

```bash
# Edit per-locale YAML
$EDITOR l10n/metadata/google/listings/en-GB.yaml

# Push
playstore listings update --lang en-GB --dry-run
playstore listings update --lang en-GB
```

Note the **default** listings location is `l10n/metadata/google/` not `l10n/metadata/play/` — the historical Lazy Sudoku split. Greenfield projects can unify via `listings_dir: {metadata_dir}` in `playstore-cli.config.yaml`.

## Release tracks

Release notes come from `play-store-*.md` files (one per language) parsed for their `## What's New` section. Promote a build through tracks:

```bash
playstore tracks list                       # current state
playstore tracks update internal --version-code 60710 --status completed
```

## CI integration

Both `iap sync` and `listings update` exit non-zero on failure:

```yaml
# .github/workflows/release.yml
- name: Push Play metadata
  env:
    GOOGLE_PLAY_KEY_FILE: ${{ secrets.PLAY_SA_KEY_PATH }}
  run: |
    playstore listings update --all
    playstore iap sync
```

For preview-mode CI (PR builds that shouldn't touch live state):

```yaml
- name: Validate metadata
  run: |
    playstore listings update --all --dry-run
    playstore iap sync --dry-run
    playstore iap diff           # exits 0 even with divergence
```

## Screenshots

```bash
# Upload one language's set, replacing whatever's there
playstore screenshots upload --source ./shots/en-GB --lang en-GB --mode replace

# Upload every language
playstore screenshots upload --source ./shots --all --mode replace
```

`./shots/<lang>/` should contain device-categorised files matching Play's naming conventions (phone, sevenInch tablet, tenInch tablet).
