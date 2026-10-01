# Deployment record

Original deployment, verified on 2026-09-30:

- Worker: `https://meme-autoposter.meme-autoposter.workers.dev`
- Health: `https://meme-autoposter.meme-autoposter.workers.dev/health`
- Meta callback: `https://meme-autoposter.meme-autoposter.workers.dev/webhooks/instagram`
- `MEDIA` binds to existing R2 bucket `meme-autoposter-media`, Standard storage, EEUR.
- R2 public `r2.dev` access is disabled; no custom bucket domains are configured.
- Prefix-scoped lifecycle rule `meme-autoposter-expiry-2d` removes `meme-autoposter/` objects after two days. Existing default multipart rule was preserved.
- `DB` binds to D1 `meme-autoposter-jobs`, ID `1b806c2e-6ced-4845-a694-3fbf13af0b79`; migration `0001_jobs.sql` is applied remotely.
- Cron runs each minute. Worker startup reported 1–2ms; bundle is approximately 39 KiB uncompressed.
- Generated `ADMIN_TOKEN` and `META_VERIFY_TOKEN` are installed as Worker secrets. Local copies remain under ignored `.secrets/`; no values are in this record.
- Remote health, actual Meta GET challenge response and admin 401 protection passed.
- Lint, typecheck, 25 Workers-runtime tests, dependency audit and bundle dry run passed. [GitHub implementation checks](https://github.com/RebarFw/meme-autoposter/actions/runs/36767423490) succeeded.

Next required external action: configure Meta's callback/verify token and select `messages`, keeping the app in development. Buffer key, Meta app secret, Meta access token and the approved Instagram-scoped sender secret still need to be entered securely. Channel discovery and real account publication have not been exercised. No real posts were created during development.

## Current deployment: 2026-10-01

The original setup actions above have been completed. Secrets and Buffer channel discovery are installed, and actual authorized Reel DMs have published through the Worker to both channels. Meta remains unpublished; the authorized minute API polling mode is active. Normal operation does not depend on a local PC.

Worker version `8b9ec926-d4f3-48b8-9225-92412cef51f7` preserves the same URL, private R2/D1 bindings, existing secrets and minute cron. D1 migration `0002_apify_budget.sql` is applied remotely. The Worker raises the Apify ceiling to 500 attempts, requires a verified Free account and platform limit at most $5, reserves $0.0073 per attempt, and stops before a conservative $4.50 threshold for the rest of the verified billing period. No paid plan or overage was enabled. Startup was 1ms; bundle was 110.49 KiB uncompressed.

Lint, typecheck, 95 integration tests, remote health, real Meta GET handshake and administrator protection passed. A full Worker-side Apify MP4 download passed with the new limit. See [the current live financial and publication evidence](testing.md#500-run-cap-and-credit-protection-2026-10-01). No external operator action is pending for this cap change.
