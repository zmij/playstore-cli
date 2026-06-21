# Listings YAML schema

Per-language YAML lives at `<listings_dir>/listings/<lang>.yaml` (default `l10n/metadata/google/listings/<lang>.yaml` — the Lazy Sudoku historical split).

One file per language. The lang code is BCP-47 (`en-GB`, `de-DE`, etc.); Play's locale matrix is shorter than Apple's.

## Shape

```yaml
# l10n/metadata/google/listings/en-GB.yaml

title: "Lazy Sudoku"
short_description: "Solve smarter, not harder"
full_description: |
  The most relaxing sudoku app on the store.

  • Classic + diagonal + jigsaw variants
  • Apple Pencil-friendly note-taking
  • Camera scanner for paper puzzles

video: "https://www.youtube.com/watch?v=dQw4w9WgXcQ"   # optional, one per locale
```

## Field reference

| YAML field | Play field | Limit | Notes |
|---|---|---|---|
| `title` | `title` | 30 chars | App name in the Play Store |
| `short_description` | `shortDescription` | 80 chars | Tagline shown in search results |
| `full_description` | `fullDescription` | 4000 chars | Markdown-ish — line breaks preserved, no formatting tags |
| `video` | `video` | YouTube URL | One per locale; Play embeds it on the listing |

Play silently truncates over-limit fields. Verify with `playstore listings show --lang <lang>` after a push.

## Release notes (`whats_new`)

Unlike Apple, Play's "What's New" lives **per-track-release**, not per-listing. The CLI loads release notes from separate Markdown files (one per language) by scanning `play-store-*.md` files in `<listings_dir>/`:

```markdown
<!-- l10n/metadata/google/play-store-en.md -->

## What's New

• Reworked solver
• Faster startup
• Bug fixes
```

The `tracks update` command parses the `## What's New` section out of each file and attaches the result to the release's `releaseNotes[]` array, one entry per language.

To translate release notes, drop `play-store-<lang>.md` files alongside the English one (the filename's lang code maps to a Play locale via `LANGUAGE_MAP` in `src/types.ts`).

## Multi-line values

YAML's `|` literal-block syntax preserves line breaks. Use it for `full_description`:

```yaml
full_description: |
  Paragraph one.

  Paragraph two. **Bold not supported** — Play strips formatting.
  Only line breaks survive.
```

## Per-locale strategy

Each locale's file is independent. Common pattern:

- `en-GB.yaml` is your authoritative copy.
- Other locales are translations.
- `short_description` is the highest-leverage field — it shows in search results. Translate carefully.
- `video` can be the same YouTube URL across locales (Play doesn't auto-detect the user's preferred locale for YouTube playback) or different per-locale if you have translated reels.

## Locale codes

Play uses BCP-47 codes. Common ones:

| Lang | Play locale |
|---|---|
| English (UK) | `en-GB` |
| English (US) | `en-US` |
| German | `de-DE` |
| French | `fr-FR` |
| Spanish (Spain) | `es-ES` |
| Spanish (Latin America) | `es-419` |
| Portuguese (Brazil) | `pt-BR` |
| Portuguese (Portugal) | `pt-PT` |
| Chinese (Simplified) | `zh-CN` |
| Japanese | `ja-JP` |
| Korean | `ko-KR` |
| Arabic | `ar` |
| Russian | `ru-RU` |
| Hindi | `hi-IN` |
| Indonesian | `id` |
| Finnish | `fi-FI` |
| Hebrew | `iw-IL`   (Play uses `iw`, not `he`, for legacy reasons) |

Note the Hebrew quirk: Play's locale code is `iw-IL`, not `he-IL`. Use `iw-IL.yaml`.

Add a language by creating `<lang>.yaml` and running `playstore listings update --lang <lang>`. The CLI creates the listing on Play if it doesn't exist.

## Push paths

```bash
# Update everything from every per-locale YAML
playstore listings update --all

# One locale only
playstore listings update --lang ja-JP

# Dry-run first
playstore listings update --all --dry-run
```

## Diff

```bash
playstore listings show --lang ja-JP
# Compare against your local ja-JP.yaml manually for now;
# a dedicated `listings diff` would mirror `iap diff` and is on the
# follow-up list.
```

## Screenshots are separate

`playstore screenshots` is its own command surface. Screenshots aren't part of listings YAML — they're binary uploads keyed by `(language, device_type)`:

```bash
playstore screenshots upload --source ./shots --all --mode replace
```

`./shots/<lang>/` should contain device-categorised files; filenames follow Play's convention (`phone-*`, `tablet7-*`, `tablet10-*` prefixes).
