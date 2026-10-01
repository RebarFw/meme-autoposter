# Verification

## Automated checks

`npm run check` runs lint, typecheck and Workers-runtime integration tests. All 106 tests passed on 2026-10-01. Local D1/R2 bindings are real; external Buffer/Meta HTTP requests are mocked. Cases cover signature rejection, exact sender/recipient matching, stale/echo/deleted events, unsafe URLs, current/legacy and live-observed link-only shares, polling concurrency/backoff/activation cutoff, unchanged conversation timestamps, authenticated sender import, parser upgrades, atomic duplicate leases, MP4 bounds/type checks, the optional Apify contract/credential isolation/monthly ceiling, safe pre-submission download recovery, `shareNow`, uncertain mutations, both-channel success, token expiry, ranges/HEAD and orphan cleanup. Additional cases verify the website's observed URL encoding, isolated provider request formats, configured sequential order, original CDN preference, no credential/cookie forwarding, unknown/disabled providers, HTML/CAPTCHA/fake MP4 rejection before selection, unsafe redirects, bounded metadata, strict result parsing without eval, overall deadline and both-channel creation once through a free fallback. Financial cases cover the concurrent 500-run boundary, shared account spending, concurrent money reservations, unavailable/malformed usage, unsafe platform limits, paid-plan rejection, limit lowering/readback, preserving smaller limits, old counter migration, billing-cycle rollover, regressing usage reports and persistent stops that make no further Apify calls. No real account posting happens in these tests.

`npx wrangler deploy --dry-run --outdir dist` confirms the bundle and binding configuration. `npm run deploy` verifies remote health and GET webhook verification, but that does not establish messaging permissions or video download viability.

## Real acceptance test after setup

1. Keep Meta unpublished as requested; authorize owned accounts/testers; configure the callback and `messages` field. Enter Worker secrets securely, then run `npm run setup` and `npm run meta:diagnose`. Test the callback with Meta's dashboard synthetic test. The current Instagram Login dashboard requires a published app for real webhook notifications; the operator has authorized `INGEST_MODE=polling` instead. Do not publish the app or start App Review automatically.
2. Run `npm run owner:start`, send its one-time message from the approved personal account to the meme page, then use `npm run owner:import -- PERSONAL_USERNAME SETUP_DM_CODE` and `npm run owner:finish` to install the exact API-verified sender securely. An already sent setup message from the last 48 hours can be imported. Run `npm run polling:validate` to test actual owner-filtered conversation access and the share fields. Confirm polling is initialized and healthy with `npm run status`. Sender installation creates no publishing jobs. In future webhook mode, a real signed setup DM can establish the proof instead.
3. Share one short MP4 Reel that you own or have permission to repost from the approved personal account to the meme page. Record the D1 job hash using `npm run status`.
4. Confirm exactly one Buffer create per channel, both with immediate mode. Confirm both actual network posts, and final `completed` with both Buffer `sent` statuses.
5. Verify its R2 object is gone after both publications. Polling the same message again must leave the same job/post IDs. Signed webhook retries in polling mode must create no second ingestion path.
6. DM another Reel from an unapproved test account. Confirm no new job and no Buffer post.
7. Test a shared image/story or random text. Confirm no publish. Test an inaccessible Reel; confirm a fixed error state and eventual cleanup.
8. If `no_downloader_could_resolve_reel` occurs, inspect the provider error codes, `download:diagnose` and `download:probe` first. The live native test returned `shares.link` but public pages exposed no video metadata. The website adapters may be challenged even if they work in a desktop browser. An optional Apify provider is available with `DOWNLOADER_API_KEY` from a Free account. After establishing a usable provider, use the guarded `retry:download` command to resume the same pre-submission job. Never promise the native Share flow works before actual download and publication.
9. Enable owner confirmation only after send-message permission works. Its success must mean both channels are actually `sent`.

## Scope of confidence

Mocked tests prove the local logic and API request shape against documented contracts. They cannot prove a particular key's scopes, Meta account roles, the shape of a real third-party share, Instagram's public page availability, Buffer's ingest timing, social-network video requirements, or Free-plan CPU behavior with a large real video. Inspect Worker metrics during the first live test. If actual CPU exceeds the Free allowance, investigate the stage before considering a paid plan; deployment does not upgrade automatically.

## Live website probes: 2026-10-01

Worker version `4d9f39e0-4419-4846-9cd8-88aa90e5bae0` contains the website adapters and preserved existing secrets, private R2 binding, D1 and minute polling. Remote health, Meta GET handshake and administrator protection passed. No paid product was enabled.

Local VideoDropper request for the existing authorized Reel returned HTTP 200 JSON with one original Meta CDN `.mp4` URL. This probe did not establish a valid downloaded file or publication. The same provider attempts were then tested through the deployed protected endpoint with bounded requests and normal public request headers:

| Provider | Worker result |
| --- | --- |
| VideoDropper | HTTP 403 challenge markup; rejected. |
| FastDL | JSON containing only a `code` field and no `video_versions`; rejected. No shortcode, source URL or result content was returned/logged by diagnostics. |
| SaveFrom | Anonymous request rejected as unavailable; rejected. |
| SnapInsta | HTTP 403 with Cloudflare's challenge header; rejected. |

Probes returned fixed facts/errors only, never sent account credentials to these sites, executed no returned scripts, solved no CAPTCHA, wrote no R2 media and created no Buffer post. At this stage the original job was `attention` with zero deliveries. It was subsequently recovered without creating a new job, as described below. The website resolver limitations from Worker egress remain.

## Real download and publication: 2026-10-01

Worker version `aff025b6-ced5-4232-b4c6-a81b5cf53e1e` added guarded local resolution recovery and status-only refresh for this acceptance test. The final deployed version is `2a7d7ca4-4508-4dd2-8961-1c5af8098f40`; it also requires both deliveries to remain accepted before marking completion, so a sent reminder cannot count as automatic publication. Lint, typecheck and all 87 tests passed. New integration cases cover concurrent recovery, original Reel matching, unsafe CDN URLs, future timestamps, completed-job rejection, private media deletion after both mocked posts are sent and rejection of reminder-based completion. Remote health, Meta GET verification and administrator protection also passed.

`recover:download` resolved the existing authorized Reel using the public VideoDropper flow from the local machine. The signed Meta CDN URL remained in memory and was supplied to the protected retry endpoint with the exact original Reel. The Worker resumed the **same** job `ede134208793196d0ecc58f8e6c76335c6a8172473247ae93a93e6e525ada93f`, validated and downloaded the MP4, and stored **742,341 bytes** in private R2. Structured live logs recorded `media_stored` and both accepted immediate Buffer submissions; invocation outcome was `ok`.

| Destination | Buffer post ID | Actual API status |
| --- | --- | --- |
| Instagram `@okbruhfiles` | `6abe1f46a47ba1ccb1be96c8` | `sent`, automatic |
| TikTok `@viral.yt.video` | `6abe1f52cdd0bfd973a56c12` | `sent`, automatic |

Both statuses were read back through Buffer, not inferred from mutation acceptance. The job became `completed` with no error. A remote R2 lookup of `meme-autoposter/JOB_HASH.mp4` returned **The specified key does not exist**, confirming physical cleanup. Subsequent owner polling received no new job; attempting guarded retry on the completed job returned `download_retry_not_safe`. The final state retains exactly one job and the same two post IDs, with no duplicate creation.

This proved actual download and publication for the permitted test Reel, using local resolution plus Worker download/publishing. At this stage fully autonomous Worker-only resolution remained unverified. All four website adapters retain the egress limitations above; the subsequent Apify verification below establishes a usable Worker-compatible provider. No paid product was enabled and Meta remains unpublished.

## Installed token and live Apify transfer: 2026-10-01

`secrets:status` confirmed `DOWNLOADER_API_KEY` is installed without reading/printing its value; `DOWNLOADER_PROVIDER=apify` was already selected. Worker version `86162b88-5989-4992-8810-11341a439787` adds a separate administrator-only Apify test. The website-only probe retains its original behavior and cannot invoke Apify. The new test rechecks the stored DM's exact owner, owned recipient, Reel evidence and recent timestamp before using the existing provider and credit ceilings. It accepts no external URL, leaves job/delivery records unchanged and drains the MP4 without storing it in R2.

The live `download:probe-apify` result was `resolved=true`, `contentType=video/mp4`, **955,746 bytes**, `mp4SignatureVerified=true`, `fullDownloadVerified=true`. This was an actual Apify API request and full Meta CDN transfer from Cloudflare, with the credential retained only in the Apify authorization header. It tested the latest approved Reel DM described below, did not rely on local website resolution, and had no attachment URL to reuse. The exact shortcode and Reel/video type matched that DM.

The original job remained `completed`, and its Instagram/TikTok post IDs stayed unchanged with both `sent`. No duplicate post was created by the test. Remote health, Meta verification and administrator protection passed. Lint, typecheck and **88 tests** passed; the additional integration case verifies a completed-job probe, full transfer, truncated-media rejection, owner mismatch rejection before API calls, no R2 write and no Buffer call. The test uses the same 40-run monthly/$0.05-per-run ceilings; no paid account/plan was enabled.

## New DM: fully automatic acceptance test

After token installation, the approved owner shared a **different Reel**. Its Meta message timestamp was `1790845649000`. The stored source had a Reel permalink but **no attachment URL or media ID**. Minute polling created job `7ddff063818595f3310cfd77a38918ff4825d2f537679c410096234909766933` at `1790845695909`; it completed at `1790845938844`. No operator retry/local-resolution command was executed for this job. Apify usage was two October runs: the automatic download and the subsequent explicit full-transfer probe.

| Destination | Buffer post ID | Actual API status |
| --- | --- | --- |
| Instagram `@okbruhfiles` | `6abe231f986f982efb2df582` | `sent`, automatic |
| TikTok `@viral.yt.video` | `6abe232b65495a651fdbaeec` | `sent`, automatic |

The new job is `completed` with no error. D1 confirms `object_key` and `media_token` are cleared; remote R2 lookup returned **The specified key does not exist**. The original test job and its two post IDs remain unchanged. There are exactly two jobs for the two distinct authorized messages, each with one Instagram delivery and one TikTok delivery. This establishes the full intended DM-to-both-networks workflow with Worker-compatible automatic download, rather than only a resolved URL or mocked publishing.

## 500-run cap and credit protection: 2026-10-01

Migration `0002_apify_budget.sql` was applied to the existing remote D1 without deleting jobs or tombstones. Worker version `8b9ec926-d4f3-48b8-9225-92412cef51f7` raises the maximum to 500 attempts per verified Apify billing cycle. The persistent ledger also requires the Free plan, a platform account limit no higher than $5, and highest reported total account usage plus all maximum-cost reservations below $4.50. The budget may stop downloads before 500; failed/uncertain attempts are never refunded. A stop remains locked through the rest of that cycle. Prior attempts were preserved at their old maximum cost.

Actual authenticated account API reads verified the Free plan, $5 platform limit, and the current billing period ending on 2026-10-31. The enforcement command confirmed the $5 limit; no plan upgrade occurred. A live attempt with $0.005 was rejected before the Actor could execute. Public official Actor metadata reported `minimalMaxTotalChargeUsd=0.0073`, so the fixed per-run ceiling/reservation was corrected to $0.0073. A subsequent deployed `download:probe-apify` succeeded, downloading **315,743 bytes** with MP4 MIME, signature and full-length validation. It used the latest authorized stored Reel, wrote no R2 object and created no post.

The post-probe financial diagnostic reported **5 attempts**, **$0.014408 highest observed actual usage**, **$0.1623 reserved worst case**, a **$4.50 app threshold** and **$5 account limit**; the remaining-cycle block was false. Reset time was `2026-11-01T00:00:00.000Z`. Health, Meta GET handshake and administrator protection passed. Minute cron remains deployed, so ordinary polling/download/publication/cleanup require no running PC.

Current status also showed a third distinct authorized job, `316bbf6794fe059ace873a9b5a81ed188a0f3239223190d9f101400c946ddf71`, already completed before the budget deployment. Its Instagram post `6abe261a1a5550a51dbd81d2` and TikTok post `6abe2626f2e3dac26c445672` both retain `sent` statuses. All three jobs are completed, all six original delivery IDs are retained, polling has no API error, and this budget/probe change created no duplicate publication.

## Cloudflare 99 percent target: 2026-10-01

All **106 tests** passed with lint/typecheck. Added runtime cases cover account-wide dataset parsing, cached/leased refresh, daily high watermarks and persistent stops, a verified new UTC day, D1 read/write projections, unavailable credentials/API and partial data, non-free storage rejection, concurrent R2 operation/byte reservations, reported usage catching up without duplicate counting, free cleanup during a pause, paused ingestion/cron, protected controls and real native R2 stream upload/read/deletion. An exhausted reservation cancels an unconsumed upload stream, and a budget exhausted during the download leaves the same job pending with its retry allowance and no Buffer deliveries.

The newly installed reader initially produced an actual GraphQL authorization failure. Cloudflare's token policy summary showed User API Tokens Read rather than Account Analytics Read. After correcting the existing token to the requested account-scoped reader, `cloudflare:validate` succeeded through the deployed Worker. At `2026-10-01T11:32:47.220Z`, the enabled guard reported capacity available: **821 Workers requests, 16,145 D1 rows read, 1,628 rows written, 106,496 D1 bytes, 120 R2 Class A attempts, 207 Class B attempts, 955,825 peak R2 bytes, and zero outstanding reserved media bytes**. These are the guard's analytics/reservation measurements, not invoice totals.

Live `cloudflare:probe` passed before activation and again on version `fd619c08-36d6-4ce7-a0b1-08e301921bef`: a 24-byte MP4 header streamed through the guarded upload, HEAD and GET agreed on size, deletion succeeded and a subsequent HEAD confirmed absence. Each probe reported `postsCreated=0`; no publishing job or public media URL was created. Remote health, Meta verification and unauthorized admin 401 also passed.

Normal polling continued receiving distinct authorized DMs during development. The post-deployment status contained six completed jobs and twelve accepted/sent deliveries, with all original six delivery IDs unchanged and no polling error. Diagnostic probes did not resubmit them. This change tests transport/quota behavior without reposting existing content. A real account billing-boundary test was deliberately not performed: it would consume nearly all free quota and could risk charges. The [documented 99% target limitations](cloudflare-usage.md) remain applicable.
