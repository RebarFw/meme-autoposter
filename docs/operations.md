# Operation and recovery

Use `npm run status` for the most recent jobs and per-channel outcomes. Use `npx wrangler tail` for structured event logs. Never include credentials, source payloads or temporary media URLs in bug reports.

With `INGEST_MODE=polling`, status also reports the last successful scan, next allowed scan, fixed API error code and inspected/received counts. `npm run polling:validate` tests owner-filtered conversation and message/share access without posting. `npm run poll` invokes the same guarded scan when due. API errors back off up to one hour; successful scans resume the next minute boundary. Check token validity and Meta diagnostics if polling errors persist. History before polling activation is excluded; the most recent 20 API-visible messages are checked, so a long outage can exceed the recoverable history. Only the installed exact sender may create jobs.

States: `pending` downloads; `ready` uploads are complete and Buffer creates are ready; `waiting` polls accepted posts; `completed` means both actual post statuses are `sent`; `failed` means definite failure; `attention` means a failed downloader, ambiguous Buffer result, stuck job or expired media. Each delivery remains separate.

New downloads persist the original Reel caption after removing full `@mentions`, applying the shared text limit and retaining up to three source hashtags plus `#fyp #memes`. Caption metadata comes from the same downloader result; no second Actor run or paid language model is used. Missing original text produces hashtags alone. Protected `download:probe-apify` also reports caption presence, hashtag counts, mention removal and length validation as safe facts, without returning/logging caption contents. It creates no post. Completed/accepted deliveries are never reset or edited by a caption-policy deployment.

## Uncertain Buffer mutation

Do not reset `unknown` or `submitting` to `pending`. Check the appropriate Buffer channel's recent posts and the stored post IDs. A network timeout can mean a post was created. Reconciliation must link the existing Buffer post ID, or establish that no create took place, before deliberately creating new content. The same original DM remains a tombstone and will not trigger again. This protects the no-duplicates requirement even across a crash between the remote API call and D1 result storage.

Buffer publication failures may require reconnecting the channel or correcting a video's codec/duration. These are recorded separately; an accepted post on the other network is never recreated. Do not resend content until you have checked both actual channels.

## Download failure before Buffer

`npm run download:diagnose` returns only structural public-page facts for the latest job; `-- post` and `-- embed` inspect alternative public routes. It never returns URLs, page contents or credentials, and does not upload or post. `npm run polling:validate` also reports safe structure and actual Meta errors for the latest message's share/attachment fields.

After fixing a provider/key, use `npm run retry:download` (latest job) or `npm run retry:download -- JOB_HASH`. This queues the same job only if it belongs to the current exact owner/recipient, is within 48 hours, is in `attention`, has no R2 object or active lease, and has no delivery record of any state. It resets download attempts only; permanent message deduplication remains. Cron performs the retry. Never delete delivery reservations to make this command succeed.

When a website resolves a Reel locally but rejects Worker egress, `npm run recover:download -- JOB_HASH` provides an optional operator recovery for the same pre-submission job. See `website-downloaders.md` for its exact constraints. It sends no account credentials to the resolver and keeps signed URLs in memory. It does not establish automatic future downloads or install a PC background process. `npm run posts:refresh -- JOB_HASH` performs only status reconciliation on an existing waiting job and can expedite checking a recovered older job; it cannot create posts.

The optional Apify provider consumes shared Free-plan credits. `apify_budget` records at most **500 attempted runs per actual Apify billing cycle**; probes, retries and failed calls count. Each Actor run uses `maxTotalChargeUsd=0.0073`, one Reel, and no paid add-ons. Before each run, official account/limits/monthly-usage APIs must establish the Free plan with a zero base price, at least $5 included credit, a positive platform limit no greater than $5, matching active billing periods and valid monetary totals. Financial requests send the token only in the official API's bearer header; private user/profile/proxy data is never logged or returned.

The guard uses integer microdollars. It stops before the highest reported total account usage plus **all** unreleased maximum-cost reservations and the next run can reach **$4.50**, leaving $0.50 headroom below the $5 account cap. A smaller existing platform limit lowers that threshold. This deliberately double-counts app charges already reflected in account usage, rather than releasing uncertain/delayed charges. SQL reservations and a durable stop latch protect concurrent requests. Reaching the run/credit boundary blocks further Apify calls until that billing period has ended, even after redeploy, token rotation, retry, provider outage or regressing usage reports. Fresh cycles reset counters only when Apify verifies the new cycle. Previous 40-run counters are imported once at their former $0.05 worst-case cost; they are not silently erased.

`npm run apify:budget` returns safe counts, financial thresholds, stop code and reset time without running an Actor. `npm run apify:enforce-limit` lowers an unsafe account limit to $5 and reads it back; it never raises an already smaller limit, modifies retention or upgrades a subscription. The downloader itself refuses to start if the account limit is unsafe or any financial check cannot be verified. Account-wide spending includes other Actors and storage, so 500 is a maximum and the guard can stop earlier. No paid subscription or overage is enabled by this app. Continue to keep this account on Free; the guard rejects paid-plan credentials.

After securely installing a downloader token, `npm run download:probe-apify` performs an explicit full-transfer test through the Worker using the latest stored authorized, recent Reel. It consumes one of the same limited downloader runs. The test does not enqueue, retry, upload to R2 or publish; its output contains fixed validation facts only. It can safely verify a new key using an already completed job without duplicating that post.

## Cleanup and bucket lifecycle

The [Cloudflare usage guard](cloudflare-usage.md) targets 99% of the free allowances with extra room for ongoing work. `npm run cloudflare:usage` reports the current capacity and pause code; `cloudflare:validate` verifies the real API reader, and `cloudflare:probe` explicitly tests guarded R2 upload/read/deletion without posts. Missing or stale measurements pause work. Daily stops persist until a newly verified UTC day; R2 operation stops use a conservative 31-day window. Existing delivery reservations/tombstones are preserved. A long pause can expire media or exceed Meta's available history. The guard cannot guarantee an exact billing cutoff, stop incoming request counts or stop other account users; keep Workers/D1 on Free and see the linked limitations before relying on it for costs.

The Worker deletes media promptly after both `sent` statuses, or after known failures no longer need it. Hard link expiry is 24 hours by default, capped at 48 hours. Minute cron cleanup and an hourly orphan sweep delete objects. Only the `meme-autoposter/` prefix is owned by this app.

An independent R2 lifecycle rule expires this prefix after two days as protection against disabled cron or a deleted Worker. The deployment tooling installs this targeted rule while preserving existing lifecycle rules. D1 capability expiry continues to enforce the shorter 24-hour access window. Lifecycle physical deletion is asynchronous, not an exact deletion time. Never install a whole-bucket expiry rule on a shared bucket.

## Configuration changes

Non-secret vars live in `wrangler.jsonc`; secrets belong in `wrangler secret put`. After redeploying, run `npm run setup` to refresh channel/account discovery if connections or access tokens changed. Existing jobs keep their per-channel IDs. The local generated admin token and verification token stay in `.secrets/`; replacing them revokes old values after uploading the new Worker secret. Secrets are never committed.

Do not rotate/delete the database to clear failures: permanent message tombstones prevent old webhook retries from posting duplicates. Back up the database before schema changes. The R2 bucket should keep public access disabled; no `r2.dev` URL is necessary.

The operator authorized minute API polling on 2026-10-01 while retaining an unpublished Meta app. Do not change app mode or submit App Review as part of maintenance. Signed webhook requests remain authenticated and acknowledged in polling mode, with no posting jobs. A deliberate switch to webhook mode retains the same canonical recipient/message tombstones.


## Free-plan CPU recovery (2026-10-26)

The minute scheduler now invokes the existing Worker through authenticated public HTTPS stages: refresh usage, poll one new owner message, perform maintenance, then one download/publish/reconciliation stage at a time for at most three due jobs. Each invocation has its own native Free-plan CPU budget. The permanent job IDs and per-channel submission reservations are retained; uncertain or already accepted posts are never automatically recreated. Account and resource checks pin local deployment commands to the English account only.

Validated MP4 data is transferred natively with FixedLengthStream/pipeTo instead of running JavaScript on every network chunk. Signature, MIME, trusted-host, exact-size, 25 MiB and private R2 validation still apply. Large public HTML parsing is skipped in the production async path to avoid another CPU overrun. Caption and hashtag processing remains the English policy.

APIFY_ASYNC_DOWNLOADS=true persists a single capped 600-second Actor run and polls its dataset. Waiting does not consume ordinary download failure attempts or start another run. Terminal retries are delayed, capped at three starts per job, and limited to four recent in-flight starts. All starts retain the FREE-plan requirement, $0.0073 maximum run charge, $4.50 credit stop, 500-run ceiling and existing account cap.

The account-wide Cloudflare usage guard now stops at 90% of the Workers/D1/R2 Standard allowances and fails closed on missing or stale measurements. Native R2 operation/storage reservations and two-day private-object lifecycle cleanup remain in force. No paid product, account upgrade, new queue or PC background process is required. Normal idle traffic is roughly four Worker invocations per minute, about 5,760/day; even the bounded busy-task maximum remains below 90,000/day for this Worker alone. Shared account activity still counts, and R2 usage guards are not a provider-enforced billing cap.
