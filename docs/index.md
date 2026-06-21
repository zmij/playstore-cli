---
layout: home

hero:
  name: playstore-flow
  text: Google Play Console from your terminal
  tagline: Manage Android listings, in-app products, and subscriptions from YAML files. CLI + bundled MCP server.
  actions:
    - theme: brand
      text: Get started
      link: /getting-started
    - theme: alt
      text: View on GitHub
      link: https://github.com/zmij/playstore-cli

features:
  - icon: 📝
    title: YAML-first
    details: Pull every per-language listing, one-time product, subscription base plan, and offer into committed YAML. Edit in your editor; sync back.
  - icon: 🔄
    title: Two-way reconcile
    details: Field-level diff with paths like `subscriptions/my_sub/base_plans/monthly/regional_configs/DE/...`. Pull updates without clobbering local edits.
  - icon: 🤖
    title: Bundled MCP server
    details: Same client code, exposed over stdio. Any MCP-aware agent (Claude Code, Cursor, Cline, Windsurf) can read and update live Play state.
  - icon: 💰
    title: Price migrations + state lifecycle
    details: Migrate existing subscribers via `batchMigratePrices`. Activate / deactivate base plans and offers from the CLI. Dry-run by default.
  - icon: ⚡
    title: One install, two binaries
    details: Single `npm install`, two binaries (`playstore` + `playstore-mcp`). Configurable for any Android project via three independent path knobs.
  - icon: 🆕
    title: Built on monetization.*
    details: Wraps the new `monetization.onetimeproducts` / `subscriptions` APIs (the legacy `inappproducts` endpoint that's dead for new accounts).
---

## What it does

`playstore-flow` puts your Android store presence under version control. Instead of clicking through the Play Console's per-language tabs and per-product editors to update copy, prices, or release notes, you pull live state into committed YAML, edit it in your editor, and sync it back through normal PR review.

The bundled `playstore-mcp` server exposes the same client code over stdio so any MCP-aware agent — Claude Code, Cursor, Windsurf, Cline, Continue, Zed — can read and update live Play state without shelling out.

## Quick install

```bash
npm install -g playstore-flow
# or, from a checkout (the GitHub repo is still `playstore-cli` —
# only the npm package name has been rebranded to `playstore-flow`):
git clone https://github.com/zmij/playstore-cli.git
cd playstore-cli && npm install && npm run build && npm link
```

Then see [Get started](/getting-started) for the first-run walkthrough.

## In production

> I built this to manage [Lazy Sudoku](https://lazy-sudoku.online)'s Play Console — 14-locale listings, plus the full IAP catalogue (9 one-time products + 3 subscriptions with monthly/annual base plans) committed as YAML and synced via `playstore iap sync`. The bundled MCP server lets Claude Code read live Play state during release prep without me leaving the terminal. Everything goes through PRs; nothing happens by clicking through the Play Console.
>
> — *Sergei Fedorov, [Lazy Sudoku](https://lazy-sudoku.online)*

Using playstore-flow somewhere? [Open a PR](https://github.com/zmij/playstore-cli/blob/master/README.md) adding yourself to the Adopters section in the README.
