# Operation and recovery

Use `npm run status` for the most recent jobs and per-channel outcomes. Use `npx wrangler tail` for structured event logs. Never include credentials, source payloads or temporary media URLs in bug reports.

With `INGEST_MODE=polling`, status also reports the last successful scan, next allowed scan, fixed API error code and inspected/received counts. `npm run polling:validate` tests owner-filtered conversation and message/share access without posting. `npm run poll` invokes the same guarded scan when due. API errors back off up to one hour; successful scans resume the next minute boundary. Check token validity and Meta diagnostics if polling errors persist. History before polling activation is excluded; the most recent 20 API-visible messages are checked, so a long outage can exceed the recoverable history. Only the installed exact sender may create jobs.

States: `pending` downloads; `ready` uploads are complete and Buffer creates are ready; `waiting` polls accepted posts; `completed` means both actual post statuses are `sent`; `failed` means definite failure; `attention` means a failed downloader, ambiguous Buffer result, stuck job or expired media. Each delivery remains separate.

## Uncertain Buffer mutation

Do not reset `unknown` or `submitting` to `pending`. Check the appropriate Buffer channel's recent posts and the stored post IDs. A network timeout can mean a post was created. Reconciliation must link the existing Buffer post ID, or establish that no create took place, before deliberately creating new content. The same original DM remains a tombstone and will not trigger again. This protects the no-duplicates requirement even across a crash between the remote API call and D1 result storage.

Buffer publication failures may require reconnecting the channel or correcting a video's codec/duration. These are recorded separately; an accepted post on the other network is never recreated. Do not resend content until you have checked both actual channels.

## Download failure before Buffer

`npm run download:diagnose` returns only structural public-page facts for the latest job; `-- post` and `-- embed` inspect alternative public routes. It never returns URLs, page contents or credentials, and does not upload or post. `npm run polling:validate` also reports safe structure and actual Meta errors for the latest message's share/attachment fields.

After fixing a provider/key, use `npm run retry:download` (latest job) or `npm run retry:download -- JOB_HASH`. This queues the same job only if it belongs to the current exact owner/recipient, is within 48 hours, is in `attention`, has no R2 object or active lease, and has no delivery record of any state. It resets download attempts only; permanent message deduplication remains. Cron performs the retry. Never delete delivery reservations to make this command succeed.

When a website resolves a Reel locally but rejects Worker egress, `npm run recover:download -- JOB_HASH` provides an optional operator recovery for the same pre-submission job. See `website-downloaders.md` for its exact constraints. It sends no account credentials to the resolver and keeps signed URLs in memory. It does not establish automatic future downloads or install a PC background process. `npm run posts:refresh -- JOB_HASH` performs only status reconciliation on an existing waiting job and can expedite checking a recovered older job; it cannot create posts.

The optional Apify provider consumes shared Free-plan credits. `settings.apify_usage` tracks at most 40 attempted runs per UTC calendar month; reservations occur before external calls and are not refunded on errors. Every run is capped at $0.05, one requested Reel, with paid add-ons disabled. A missing key makes this provider inactive; exhausted credits or budget fail closed. No paid subscription is enabled by the app.

After securely installing a downloader token, `npm run download:probe-apify` performs an explicit full-transfer test through the Worker using the latest stored authorized, recent Reel. It consumes one of the same limited downloader runs. The test does not enqueue, retry, upload to R2 or publish; its output contains fixed validation facts only. It can safely verify a new key using an already completed job without duplicating that post.

## Cleanup and bucket lifecycle

The Worker deletes media promptly after both `sent` statuses, or after known failures no longer need it. Hard link expiry is 24 hours by default, capped at 48 hours. Minute cron cleanup and an hourly orphan sweep delete objects. Only the `meme-autoposter/` prefix is owned by this app.

An independent R2 lifecycle rule expires this prefix after two days as protection against disabled cron or a deleted Worker. The deployment tooling installs this targeted rule while preserving existing lifecycle rules. D1 capability expiry continues to enforce the shorter 24-hour access window. Lifecycle physical deletion is asynchronous, not an exact deletion time. Never install a whole-bucket expiry rule on a shared bucket.

## Configuration changes

Non-secret vars live in `wrangler.jsonc`; secrets belong in `wrangler secret put`. After redeploying, run `npm run setup` to refresh channel/account discovery if connections or access tokens changed. Existing jobs keep their per-channel IDs. The local generated admin token and verification token stay in `.secrets/`; replacing them revokes old values after uploading the new Worker secret. Secrets are never committed.

Do not rotate/delete the database to clear failures: permanent message tombstones prevent old webhook retries from posting duplicates. Back up the database before schema changes. The R2 bucket should keep public access disabled; no `r2.dev` URL is necessary.

The operator authorized minute API polling on 2026-10-01 while retaining an unpublished Meta app. Do not change app mode or submit App Review as part of maintenance. Signed webhook requests remain authenticated and acknowledged in polling mode, with no posting jobs. A deliberate switch to webhook mode retains the same canonical recipient/message tombstones.
