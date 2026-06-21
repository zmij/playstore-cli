# Get started

A 5-minute walkthrough from zero to your first round-tripped Play listing.

## 1. Install

```bash
npm install -g playstore-cli
```

Two binaries land on your `PATH`:

| Binary | Purpose |
|---|---|
| `playstore` | The CLI |
| `playstore-mcp` | The MCP server (stdio) — used by Claude Code / Cursor / other agents |

Verify:

```bash
playstore --help
which playstore-mcp
```

If you'd rather work from a checkout (handy when contributing back):

```bash
git clone https://github.com/zmij/playstore-cli.git
cd playstore-cli && npm install && npm run build && npm link
```

## 2. Create a Play service account

Google Cloud Console → **IAM & Admin → Service Accounts** in the project linked to your Play Console. Create a service account, generate a JSON key, download it once (Google won't show it again).

Then in Play Console → **Setup → API access**, link the service account and grant it the roles you need (Release manager + Edit store listing for the full CLI surface; tighter roles work for read-only).

Note your app's **package name** (e.g. `com.yourcompany.yourapp`) from any APK / AAB you've uploaded, or from Play Console → your app → Dashboard.

See [Authentication](/auth) for role tuning, key rotation, and env-var overrides.

## 3. Drop the config file

The CLI looks for credentials in `<repo>/.secret-stuff/` by default. Create the directory (gitignored — never commit) and the config:

```yaml
# .secret-stuff/playstore-config.yaml
package_name: "com.yourcompany.yourapp"
service_account_key: "service-account.json"
```

Drop the JSON key next to it: `.secret-stuff/service-account.json`.

**Different layout?** Three independent env vars let you point at any directory split:

| Env var | Default | What it points at |
|---|---|---|
| `PLAYSTORE_SECRETS_DIR` | `.secret-stuff/` | `playstore-config.yaml` + service-account JSON |
| `PLAYSTORE_METADATA_DIR` | `l10n/metadata/play/` | `iap.yaml` |
| `PLAYSTORE_LISTINGS_DIR` | `l10n/metadata/google/` | Per-language listings + screenshots + release notes |

Why three knobs and not one? Play has historically split IAP YAML and listings across two directories; the CLI defaults match Lazy Sudoku's layout, but downstream users can unify by setting `METADATA_DIR` and `LISTINGS_DIR` to the same value. See the [README's Configuration section](https://github.com/zmij/playstore-cli#configuration).

## 4. Pull live state into YAML

Read-only — proves auth works and gives you a starting point.

```bash
# Listings: per-language store copy + release notes → l10n/metadata/google/listings/<lang>.yaml
playstore listings export

# IAP catalogue: every one-time product / subscription / base plan / offer → l10n/metadata/play/iap.yaml
playstore iap export --output l10n/metadata/play/iap.yaml
```

Open the files. Commit them — they are now the source of truth for your store.

## 5. Edit + push

Edit a value in `l10n/metadata/google/listings/en-GB.yaml` — say, the `short_description`. Then preview before pushing:

```bash
# Show what would change vs. live state
playstore listings sync --dry-run

# Push it
playstore listings sync
```

Same shape for IAP:

```bash
playstore iap sync --dry-run
playstore iap sync
```

`sync` only patches fields that differ — your hand-edits don't overwrite the world. See [Workflow](/workflow) for the full export → edit → sync → pull → reconcile loop, plus the `iap create` and `iap state` paths (one-time products and subscription base plans / offers have separate state lifecycles).

## 6. (Optional) Wire up the MCP server

Let Claude Code (or any MCP client) read live Play state during release prep without you leaving the terminal:

```bash
# In the project directory where your secrets live
claude mcp add playstore playstore-mcp
```

Then ask the agent things like *"show me the en-GB listing"* or *"what subscriptions are active?"*. The agent calls the same client code the CLI uses — no shelling.

See the [README's MCP Server section](https://github.com/zmij/playstore-cli#mcp-server) for scope (local / project / user), other MCP clients (Cursor, Windsurf, Cline), and the working-directory + auth gotchas.

## Next steps

- [Workflow](/workflow) — full export → edit → sync → pull → reconcile loop, plus `iap create`, `iap state` (activate / deactivate base plans + offers), and `iap migrate-prices`.
- [IAP schema](/iap-schema) — every field in `iap.yaml`: one-time products, subscriptions, base plans, offers, regional configs (with `Money` per region + `new_regions` fallback).
- [Listings schema](/listings-schema) — per-language `listings/<lang>.yaml` shape; title / short-description / full-description / release-notes length limits.
- [Play quirks](/quirks) — non-obvious gotchas the CLI works around (`regionsVersion`, `monetization.*` vs legacy `inappproducts`, edit-session discipline, `batchUpdateStates` for one-time purchase options, DRAFT-on-create, …).
