# playstore-cli — Agent Notes

Working on the CLI or the bundled MCP server. Stays here when this package is in a monorepo; ports cleanly when extracted to its own repo.

## What this package is

A TypeScript CLI + MCP server for Google Play Console. Two binaries from one codebase:

- `playstore` — interactive CLI (commander.js)
- `playstore-mcp` — Model Context Protocol server (stdio)

Both wrap `src/client.ts`, which wraps the [`googleapis`](https://www.npmjs.com/package/googleapis) `androidpublisher_v3` surface.

## Layout

| Module | Purpose |
|---|---|
| `src/index.ts` | CLI entry — registers commands from `commands/` |
| `src/auth.ts` | Loads `playstore-config.yaml`, builds service-account auth context |
| `src/client.ts` | All Play API calls. Single source of truth |
| `src/project.ts` | `getProjectRoot()` / `getWorktreeRoot()` via git |
| `src/paths.ts` | Three configurable knobs (secrets, metadata, listings) |
| `src/types.ts` | YAML schema types (PlayIAPMetadata, ListingMetadata, etc.) |
| `src/commands/` | `iap`, `listings`, `screenshots`, `tracks`, `read` |
| `src/mcp/server.ts` | MCP server — reuses `client.ts`, no duplication |

## Rules

1. **`src/client.ts` is the only file that calls the SDK.** Add new ops there, not inside command files.
2. **Don't shell out from the MCP server.** Import `createClient` and use its methods directly.
3. **All path resolution goes through `paths.ts`.** Never hardcode `l10n/metadata/play/...` or `l10n/metadata/google/...` — use `getIapYamlPath()`, `getListingsDir()`, `getScreenshotsOrderPath()`, `getTracksBaseDir()`.
4. **Three path knobs because Play has a historical split.** IAP YAML at `metadata_dir`, listings + screenshots + release notes at `listings_dir`. Downstream projects can unify by setting both to the same value.
5. **Don't import from `auth.ts` for git roots.** Use `project.ts` directly.
6. **Read calls that start an edit session must call `client.deleteEdit()` afterwards** if you're not going to commit. The MCP server does this religiously to avoid leaking pending edits across tool calls.
7. **Lifecycle is separate from content.** `iap sync` only patches content (listings, prices, etc.) — state transitions happen via `iap state` and the dedicated client methods (`activateBasePlan`, etc.).
8. **British spelling throughout** (colour, localisation, etc.).

## How adding a new command goes

1. **Client method** in `src/client.ts`:
   ```ts
   async getReviewSummary(packageName: string): Promise<Schema$ReviewsListResponse> {
     const res = await this.publisher.reviews.list({ packageName: this.packageName });
     return res.data;
   }
   ```
2. **CLI command** in `src/commands/reviews.ts` (or extend an existing file):
   ```ts
   reviewsCmd
     .command('summary')
     .description('Show recent reviews summary')
     .action(async () => { ... });
   ```
3. **(Optional) MCP** — add to `TOOLS` array + handler case in `src/mcp/server.ts`.
4. **Verify**:
   - `npx tsc --noEmit`
   - CLI with live account
   - MCP stdio smoke test (see below)

## MCP smoke test

```bash
npm run build
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"s","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  | node build/mcp/server.js
```

For a specific tool call:

```bash
printf '%s\n' \
  '... (init + initialized as above)' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"playstore_list_iap","arguments":{}}}' \
  | node build/mcp/server.js
```

## Adding a new path knob

If you need a fourth configurable directory:

1. Add the field to `PathsConfig` in `src/paths.ts`.
2. Add a resolver function following the env > file > default precedence.
3. Update [`docs/auth.md`](docs/auth.md) (env var) and the [README](README.md) (config table).
4. Use it via `await import('../paths.js')`.

## What NOT to touch without thinking hard

- **`src/auth.ts` JWT/service-account loading** — getting this wrong silently produces 401s on every call.
- **`commands/iap.ts` deep-diff walker** — recursive walker with id-matching (purchase options by `purchase_option_id`, base plans by `base_plan_id`, regional configs by `region`). Breaking it floods the diff.
- **`commands/iap.ts` IAP YAML→wire converters** — Play uses two price shapes (`Schema$Money` for monetization, legacy `Schema$Price` for the dead `inappproducts` API). The current converters are tuned to the monetization shape; don't accidentally re-introduce a `Schema$Price` path.
- **`paths.ts` legacy split** — `listings_dir` defaults to `l10n/metadata/google/` not `l10n/metadata/play/`, on purpose. Don't "fix" this without breaking existing Lazy Sudoku users.

## When extracted to its own repo

The extraction is a `git filter-branch --subdirectory-filter tools/playstore-cli` (or `git subtree split`). The package is self-contained:

- No imports from outside `tools/playstore-cli/`.
- Auth + paths configurable via files in any git repo.
- README + this CLAUDE.md travel with it.
- The bundled MCP makes the package useful as a standalone tool from day one.

After extraction:

- Drop the monorepo-specific paragraph about "originally extracted from Lazy Sudoku" in the README.
- Consider changing the `listings_dir` default to match `metadata_dir` — the historical split is a Lazy Sudoku quirk that downstream users have no reason to inherit.
