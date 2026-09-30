# Deployment record

Verified on 2026-09-30:

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
