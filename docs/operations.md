# Operation and recovery

Use `npm run status` for the most recent jobs and per-channel outcomes. Use `npx wrangler tail` for structured event logs. Never include credentials, source payloads or temporary media URLs in bug reports.

With `INGEST_MODE=polling`, status also reports the last successful scan, next allowed scan, fixed API error code and inspected/received counts. `npm run polling:validate` tests owner-filtered conversation and message/share access without posting. `npm run poll` invokes the same guarded scan when due. API errors back off up to one hour; successful scans resume the next minute boundary. Check token validity and Meta diagnostics if polling errors persist. History before polling activation is excluded; the most recent 20 API-visible messages are checked, so a long outage can exceed the recoverable history. Only the installed exact sender may create jobs.

States: `pending` downloads; `ready` uploads are complete and Buffer creates are ready; `waiting` polls accepted posts; `completed` means both actual post statuses are `sent`; `failed` means definite failure; `attention` means a failed downloader, ambiguous Buffer result, stuck job or expired media. Each delivery remains separate.

## Uncertain Buffer mutation

Do not reset `unknown` or `submitting` to `pending`. Check the appropriate Buffer channel's recent posts and the stored post IDs. A network timeout can mean a post was created. Reconciliation must link the existing Buffer post ID, or establish that no create took place, before deliberately creating new content. The same original DM remains a tombstone and will not trigger again. This protects the no-duplicates requirement even across a crash between the remote API call and D1 result storage.

Buffer publication failures may require reconnecting the channel or correcting a video's codec/duration. These are recorded separately; an accepted post on the other network is never recreated. Do not resend content until you have checked both actual channels.

## Cleanup and bucket lifecycle

The Worker deletes media promptly after both `sent` statuses, or after known failures no longer need it. Hard link expiry is 24 hours by default, capped at 48 hours. Minute cron cleanup and an hourly orphan sweep delete objects. Only the `meme-autoposter/` prefix is owned by this app.

An independent R2 lifecycle rule expires this prefix after two days as protection against disabled cron or a deleted Worker. The deployment tooling installs this targeted rule while preserving existing lifecycle rules. D1 capability expiry continues to enforce the shorter 24-hour access window. Lifecycle physical deletion is asynchronous, not an exact deletion time. Never install a whole-bucket expiry rule on a shared bucket.

## Configuration changes

Non-secret vars live in `wrangler.jsonc`; secrets belong in `wrangler secret put`. After redeploying, run `npm run setup` to refresh channel/account discovery if connections or access tokens changed. Existing jobs keep their per-channel IDs. The local generated admin token and verification token stay in `.secrets/`; replacing them revokes old values after uploading the new Worker secret. Secrets are never committed.

Do not rotate/delete the database to clear failures: permanent message tombstones prevent old webhook retries from posting duplicates. Back up the database before schema changes. The R2 bucket should keep public access disabled; no `r2.dev` URL is necessary.

The operator authorized minute API polling on 2026-10-01 while retaining an unpublished Meta app. Do not change app mode or submit App Review as part of maintenance. Signed webhook requests remain authenticated and acknowledged in polling mode, with no posting jobs. A deliberate switch to webhook mode retains the same canonical recipient/message tombstones.
