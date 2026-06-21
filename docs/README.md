# playstore-cli docs

| File | Topic |
|---|---|
| [auth.md](auth.md) | Service-account setup, required roles, key rotation, env-var overrides |
| [workflow.md](workflow.md) | Export → edit → sync → pull loop; create + state lifecycle + migrate-prices |
| [iap-schema.md](iap-schema.md) | Full YAML schema for `iap.yaml` (one-time products, subscriptions, base plans, offers) |
| [listings-schema.md](listings-schema.md) | Per-locale `listings/<lang>.yaml` shape; release notes from `play-store-*.md` |
| [quirks.md](quirks.md) | Play-side gotchas the CLI works around (legacy `inappproducts` deprecation, `regionsVersion`, etc.) |

Top-level entry points:
- [README.md](../README.md) — install, quickstart, command reference, MCP setup
- [CLAUDE.md](../CLAUDE.md) — agent-facing development notes
