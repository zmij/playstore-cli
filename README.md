# playstore-cli

A CLI + bundled MCP server for managing **Google Play Console** metadata, screenshots, one-time products, and subscriptions from YAML files. Designed for teams that want their store listing under version control instead of click-driven through the Play Console website.

What it does:

- Pull every per-language listing, one-time product, subscription, base plan, offer, screenshot count, and release-track snapshot into committed YAML.
- Push YAML edits back to Play: localised copy, regional prices, availability, subscription base plans + offers.
- Create new one-time products + subscriptions from YAML (auto-detected by product id).
- Two-way reconcile: pull live state into committed YAML without overwriting hand-edits; field-level diff with paths like `subscriptions/my_sub/base_plans/monthly-auto/regional_configs/US/price/units`.
- Activate / deactivate base plans, sub offers, one-time offers, and purchase options via the `iap state` lifecycle command.
- Migrate existing subscribers when a base-plan price changes.

Same code is exposed as an [MCP server](#mcp-server) so an agent can read/list Play state without shelling out.

> Originally extracted from a working Lazy Sudoku setup. Defaults match that layout (`.secret-stuff/` + a split `l10n/metadata/play/` for IAP YAML / `l10n/metadata/google/` for listings + screenshots); downstream projects can either adopt the same conventions (no config needed) or override via `playstore-cli.config.yaml` / env vars — see [Configuration](#configuration).

## Install

```bash
npm install -g playstore-cli
# or, from a checkout
cd playstore-cli && npm install && npm run build && npm link
```

## Authentication

You need a [Google Play Developer service account](https://developers.google.com/android-publisher/getting_started) with the right roles assigned in Play Console. The JSON key plus the app's package name go in a config file:

```yaml
# .secret-stuff/playstore-config.yaml (gitignored — never commit)
package_name: "com.your.app"
service_account_key: "play-service-account.json"   # filename, relative to .secret-stuff/
```

Drop the downloaded `.json` next to the config in `.secret-stuff/`. See [docs/auth.md](docs/auth.md) for service-account setup and required roles.

## Configuration

The Play side has a quirk the appstore-cli doesn't: the metadata is split across two directories in the Lazy Sudoku layout, and the defaults preserve that. Three knobs let downstream projects either keep the split or unify:

| Knob | Default | Holds |
|---|---|---|
| `secrets_dir` | `.secret-stuff/` at project root | `playstore-config.yaml` + service-account JSON |
| `metadata_dir` | `l10n/metadata/play/` at worktree root | `iap.yaml` (one-time products + subscriptions) |
| `listings_dir` | `l10n/metadata/google/` at worktree root | `listings/<lang>.yaml`, `screenshots/order.yaml`, `play-store-*.md` release notes |

To override, drop a `playstore-cli.config.yaml` at the worktree root:

```yaml
# Greenfield project: unify everything under one dir
secrets_dir:  config/playstore-secrets
metadata_dir: store-metadata/play
listings_dir: store-metadata/play            # same dir → no split
```

Or via env vars (highest priority):

```bash
PLAYSTORE_SECRETS_DIR=...
PLAYSTORE_METADATA_DIR=...
PLAYSTORE_LISTINGS_DIR=...
```

The CLI uses git to find the project root (so secrets live with the main repo, not in worktrees) and the worktree root (so per-branch metadata edits stay local).

## Quickstart

```bash
# 1. Pull current Play state into YAML
playstore iap export --output l10n/metadata/play/iap.yaml

# 2. Edit the YAML in your editor
$EDITOR l10n/metadata/play/iap.yaml

# 3. Preview the push
playstore iap sync --dry-run

# 4. Push
playstore iap sync
```

Same flow for listings:

```bash
playstore listings update --all --dry-run
playstore listings update --all
```

See [docs/workflow.md](docs/workflow.md) for the full loop including create, state lifecycle, and price migration.

## Commands

### App + track info

```bash
playstore info                                       # package name, default lang, contact info
playstore tracks list                                # all release tracks + version codes
playstore tracks show <track>                        # one track's detail
```

### Listings

```bash
playstore listings list
playstore listings show --lang en-GB
playstore listings update --all [--dry-run]
playstore listings update --lang en-GB
```

### In-App Products + subscriptions

```bash
playstore iap list                                                   # quick stats
playstore iap show <productId>                                       # full detail (auto-detects type)
playstore iap export --output l10n/metadata/play/iap.yaml            # overwrites file
playstore iap sync [--product-id X] [--dry-run]                      # YAML → Play
playstore iap create [--product-id X] [--dry-run]                    # provision new
playstore iap pull [--product-id X] [--dry-run]                      # Play → YAML (additive)
playstore iap diff [--product-id X]                                  # field-level divergence
playstore iap state [--product-id X] [--dry-run]                     # reconcile lifecycle (active/inactive)
playstore iap migrate-prices --product-id X --base-plan-id Y --regions <list|all> [--cutoff ISO] [--increase-type TYPE]
```

One-time products, subscriptions, base plans, offers, and offer state all round-trip through `iap.yaml`. See [docs/iap-schema.md](docs/iap-schema.md) for the YAML schema.

### Screenshots

```bash
playstore screenshots list --lang en-GB
playstore screenshots upload --source ./shots --lang en-GB --mode replace
playstore screenshots upload --source ./shots --all --mode replace
```

Modes: `replace` (drop + re-upload), `add` (append).

## MCP Server

The package ships a bundled MCP server (`playstore-mcp`) using the same client code as the CLI. Any MCP-aware agent — Claude Code, Cursor, Windsurf, Cline, Continue, Zed — can talk to it over stdio.

### Prerequisites

`playstore-mcp` must be on `$PATH`. The [Install](#install) step puts it there (either `npm install -g playstore-cli` or `npm link` from a checkout). Verify:

```bash
which playstore-mcp
```

If you'd rather not install globally, register an absolute path instead — see below.

### Register with Claude Code

```bash
# Run from the project whose Play listing you manage — that becomes the
# server's working directory, which is where config + metadata YAMLs are
# resolved from. See "Working directory and auth" below.
claude mcp add playstore playstore-mcp
```

`claude mcp add` defaults to **local** scope (your account, this directory). Pick the scope that fits:

| Scope | Where it's stored | Use when |
|---|---|---|
| `--scope local` (default) | `~/.claude.json`, keyed by cwd | Personal experiments in one repo |
| `--scope project` | `<repo>/.mcp.json` (committed) | Everyone in the repo gets it |
| `--scope user` | `~/.claude.json` global | You want it everywhere |

If you skipped `npm link`, register the build output directly:

```bash
claude mcp add playstore node /absolute/path/to/playstore-cli/build/mcp/server.js
```

### Register with other MCP clients

Clients that read a JSON config (Cursor, Windsurf, Cline, Continue, Zed, …) take this shape. Point `command` at the binary on `$PATH`, or use an absolute path:

```json
{
  "mcpServers": {
    "playstore": {
      "command": "playstore-mcp"
    }
  }
}
```

Consult your client's docs for *where* this config file lives — common paths are `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`, or a workspace-level file.

### Working directory and auth

The MCP server inherits its **working directory** from the client that spawns it. Path resolution (where `playstore-config.yaml`, the service-account JSON, and the metadata / listings YAMLs live) starts from `git rev-parse --show-toplevel` of that cwd, with one refinement: when the server detects it's running inside a git submodule (via `git rev-parse --show-superproject-working-tree`), it resolves paths against the parent worktree instead of the submodule's own root.

Practical implications:

- Launch your MCP client from the repo whose Play listing you manage. The server then finds `.secret-stuff/playstore-config.yaml` + the service-account JSON, and the metadata + listings YAMLs from there.
- If your client launches from somewhere else, override paths via env vars passed through the client config:

```json
{
  "mcpServers": {
    "playstore": {
      "command": "playstore-mcp",
      "env": {
        "PLAYSTORE_SECRETS_DIR": "/abs/path/to/secrets",
        "PLAYSTORE_METADATA_DIR": "/abs/path/to/metadata",
        "PLAYSTORE_LISTINGS_DIR": "/abs/path/to/listings"
      }
    }
  }
}
```

See [Configuration](#configuration) for the full env var list — the three knobs are independent because Play splits IAP YAML and listings/screenshots across two directories by default.

### Verify

```bash
claude mcp list
```

Then in a session, ask the agent to call `playstore_get_app_info` — the first tool call confirms wiring. An "auth failed" error means wiring is fine and you just need a valid `playstore-config.yaml`.

### Tools exposed

| Tool | Description |
|---|---|
| `playstore_get_app_info` | Package name, default language, contact info |
| `playstore_list_tracks` | Release tracks + version codes |
| `playstore_list_listings` | All store listings |
| `playstore_show_listing` | One listing by language |
| `playstore_screenshot_summary` | Per-language × phone / 7" / 10" tier counts |
| `playstore_list_iap` | One-time products via `monetization.onetimeproducts` |
| `playstore_list_subscriptions` | Subscriptions via `monetization.subscriptions` |
| `playstore_show_iap` | Full product detail; auto-detects one-time vs subscription |

Auth + paths come from the same config files as the CLI.

## Play quirks worth knowing

The Play side has several non-obvious gotchas the CLI works around. Captured in [docs/quirks.md](docs/quirks.md):

- **Legacy `inappproducts` API is dead.** Newer accounts get 403 "migrate to the new publishing API." Use `monetization.onetimeproducts` only.
- **Pricing is concrete `Money { currency_code, units, nanos }` per region.** No anchor + tier auto-equalise. `new_regions` USD+EUR is the fallback for any region Play opens in future.
- **Region codes are ISO-2** (`US`, `DE`), not ISO-3 like Apple.
- **No "subscription groups"** — each subscription stands alone.
- **One-time PURCHASE OPTIONS have no individual activate/deactivate** — only `batchUpdateStates`. The CLI's `iap state` handles batching for you.
- **`regionsVersion` is required on every patch.** One-time products return it in GET; subscriptions don't. The CLI resolves a shared default by GETting the first YAML-listed one-time product.
- **Newly-created subscriptions land base plans + offers in `DRAFT`.** Use `iap state` to activate them, or flip via Play Console.
- **`updateMask: '*'` is rejected.** The CLI enumerates the patchable fields explicitly.

## Project layout

```
playstore-cli/
├── src/
│   ├── auth.ts             # config loading + service-account auth
│   ├── client.ts           # SDK wrapper (read + write methods)
│   ├── paths.ts            # secrets + metadata + listings path resolution
│   ├── project.ts          # git-root discovery
│   ├── types.ts            # YAML schema types
│   ├── index.ts            # CLI entry (commander)
│   ├── commands/           # one file per command group
│   └── mcp/server.ts       # MCP server (stdio)
├── docs/                   # auth / workflow / iap-schema / listings-schema / quirks
├── package.json            # bin: playstore + playstore-mcp
└── README.md               # this file
```

## Contributing

See [CLAUDE.md](CLAUDE.md) for agent-facing development notes.

For human contributors: PRs welcome. Run `npx tsc --noEmit` to typecheck. There are no unit tests yet — verify against a real Play account via `--dry-run` flags first.

## Adopters

> I built this to manage [Lazy Sudoku](https://lazy-sudoku.com)'s Play Console — 14-locale listings, plus the full IAP catalogue (9 one-time products + 3 subscriptions with monthly/annual base plans) committed as YAML and synced via `playstore iap sync`. The bundled MCP server lets Claude Code read live Play state during release prep without me leaving the terminal. Everything goes through PRs; nothing happens by clicking through the Play Console.
>
> — *Sergei Fedorov, [Lazy Sudoku](https://lazy-sudoku.com)*

Using playstore-cli somewhere? Open a PR adding yourself to this section.

## Licence

MIT.
