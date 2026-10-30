# Weekly Cloudflare R2 report (Gmail)

This workflow checks **both Cloudflare accounts** and emails a short report every Sunday at 08:17 UTC. GitHub Actions runs it without your PC. It also supports a manual run.

## Configure once

Open this repository's **Settings → Secrets and variables → Actions → New repository secret**, and create:

| Secret | Value |
| --- | --- |
| `CF_ENGLISH_ANALYTICS_TOKEN` | Cloudflare API token with **Account → Account Analytics → Read**, scoped only to English account `97d19512e831722d5d48aa2d05086716` |
| `CF_ARABIC_ANALYTICS_TOKEN` | Same read-only permission, scoped only to Arabic account `7d7578de8373f18cc730837758c40395` |
| `GMAIL_ADDRESS` | Gmail address sending the report |
| `GMAIL_APP_PASSWORD` | Gmail **app password** for that mailbox, NOT your main Google password |
| `REPORT_EMAIL_TO` | Gmail inbox to receive the report (optional; defaults to sender) |

Create each Cloudflare token under **Cloudflare Profile → API Tokens → Create Token**, granting Account Analytics Read on its corresponding account only. Do **not** grant Workers Edit, R2 Edit, Billing Edit, or other write permissions.

For Gmail, turn on two-step verification and (if available for your account) generate an app password in your Google Account security settings. Some Google accounts cannot use app passwords. Never share passwords/tokens in issues, chat, files, or workflow logs.

To test: open **Actions → Weekly Cloudflare free-tier report → Run workflow** and check your inbox. A missing Cloudflare analytics token produces a warning email as long as Gmail is configured. Missing Gmail credentials cause a failed workflow and no email.

## What it checks

- Account-wide R2 Standard and non-Standard storage from today's analytics snapshots
- R2 Class A and Class B operations since the start of the UTC month
- Warnings beginning at 8 GB displayed storage, 800k A operations or 8 million B operations
- Missing/partial Cloudflare analytics (warnings, **never** assumed $0)

**Important limits:** R2 free Standard storage is metered in GB-month, **not** instantaneous GB. The displayed current storage value is only a warning indicator, not a bill or price estimate. Cloudflare analytics is not the invoice and can lag. The workflow **cannot verify actual bills, account plans, paid Observability, or other Cloudflare services**. Check both accounts' **Billing → Billable Usage** and **Observability** subscriptions to confirm no fees. Alerts and this report do not stop charges. This workflow never changes subscriptions, deployments, Workers, D1, or R2. Scheduled GitHub Actions jobs may be delayed.
