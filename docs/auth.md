# Authentication

The CLI authenticates to the Google Play Developer API via a service account. This doc covers how to create one, what roles it needs, and how to plumb it into the config.

## TL;DR

```bash
# 1. Create a service account on Google Cloud + grant it Play Console access (see below)
# 2. Download the JSON key to .secret-stuff/
# 3. Write .secret-stuff/playstore-config.yaml:
#    package_name: "com.your.app"
#    service_account_key: "play-service-account.json"
# 4. Smoke-test:
playstore info
```

## Creating a service account

The setup has **two halves** — Google Cloud (where the service account lives) and Play Console (where you grant it the right roles).

### Half 1: Google Cloud

1. [console.cloud.google.com](https://console.cloud.google.com/) → pick or create a project.
2. **IAM & Admin → Service Accounts → Create Service Account**.
3. Name it something obvious (`play-publisher`, `play-cli-readonly`, etc.).
4. **Don't grant any GCP roles here** — Play access is granted in Play Console, not GCP IAM.
5. After creating, click the account → **Keys → Add Key → Create new key → JSON**.
6. Save the downloaded JSON to your repo's `.secret-stuff/`.

### Half 2: Play Console

1. [play.google.com/console](https://play.google.com/console/) → **Users and permissions → Invite new users**.
2. Email is the service account's email (looks like `play-publisher@your-project.iam.gserviceaccount.com`).
3. **App access**: pick the app(s) this service account should manage.
4. **Account permissions** + **App permissions**: see roles below.
5. Save. Propagation takes a few minutes.

## Required roles

For the operations the CLI supports, you want **at minimum**:

| Permission | Why |
|---|---|
| **View app information and download bulk reports** | Required for almost every read |
| **Edit store listing, pricing & distribution** | `listings update`, `iap sync`, `iap migrate-prices` |
| **Manage store presence** | Custom store listings, store-listing experiments |
| **Manage production releases** + **Manage testing tracks** | `tracks` commands |

For read-only setups (CI checks, dashboards), the **View app information** role on its own is enough for `playstore info`, `iap list`, `iap show`, `iap diff`, `listings show`.

For pushes, you want `Edit store listing` + `Manage releases` per app you're managing.

## Multiple service accounts

You can configure multiple keys, though playstore-cli's config format is simpler than appstore-cli's — one `service_account_key` per config file. To use multiple, either:

- Run with `--key-file <path>` to override per call.
- Set `GOOGLE_PLAY_KEY_FILE` env var for the shell.

Or maintain multiple worktrees with different configs if you have a strong separation between read-only and read-write keys.

## Auth lifecycle

The CLI uses the `googleapis` library, which handles OAuth2 token exchange automatically:

1. Reads the JSON key.
2. Signs a JWT assertion (`iss`, `scope`, `aud`, `exp`).
3. Exchanges the JWT for an OAuth2 access token via Google's token endpoint.
4. Caches the access token for ~1 hour (Google's default).

You don't manage tokens — they refresh automatically as needed. The JSON key never leaves your machine.

## Service-account rotation

```bash
# 1. Create a NEW JSON key on Google Cloud (keep the old one active)
# 2. Drop the new JSON in .secret-stuff/
# 3. Smoke with --key-file <new-json>
playstore info --key-file .secret-stuff/play-new.json
# 4. Once you've confirmed it works, swap service_account_key in playstore-config.yaml
# 5. Delete the old key on Google Cloud
```

If you're paranoid about Play API access during rotation, the old key keeps working until you delete it; there's no atomic-swap required.

## Validating auth

The cheapest read is `playstore info`:

```bash
playstore info
# {
#   "packageName": "com.your.app",
#   "defaultLanguage": "en-GB",
#   "contactWebsite": "https://your.app",
#   ...
# }
```

If you see `403 Forbidden`, the service account doesn't have Play Console access for that app — go back to Play Console → Users and permissions and add it.

If you see `401 Unauthorized` or `invalid_grant`, the JSON key is wrong (typo in path, corrupted file, or revoked on GCP).

## Security

- **Never commit `play-service-account.json` or `playstore-config.yaml`.** Verify `.secret-stuff/` is in your `.gitignore` before your first commit.
- The JSON private key is stored on disk only; the CLI loads it on each run, exchanges it for an access token, and caches the access token in-process for the request lifetime.
- Service accounts can be revoked in either GCP IAM (kills the JWT signing) or Play Console (kills the app access). Use both during rotation for defence in depth.

## Env-var overrides

| Var | Effect |
|---|---|
| `GOOGLE_PLAY_KEY_FILE` | Use this JSON path instead of the config's `service_account_key` |
| `PLAYSTORE_SECRETS_DIR` | Where to look for `playstore-config.yaml` + JSON |
| `PLAYSTORE_METADATA_DIR` | Override where `iap.yaml` lives |
| `PLAYSTORE_LISTINGS_DIR` | Override where listings + screenshots + release notes live |
