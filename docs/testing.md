# Verification

## Automated checks

`npm run check` runs lint, typecheck and Workers-runtime integration tests. All 87 tests passed on 2026-10-01. Local D1/R2 bindings are real; external Buffer/Meta HTTP requests are mocked. Cases cover signature rejection, exact sender/recipient matching, stale/echo/deleted events, unsafe URLs, current/legacy and live-observed link-only shares, polling concurrency/backoff/activation cutoff, unchanged conversation timestamps, authenticated sender import, parser upgrades, atomic duplicate leases, MP4 bounds/type checks, the optional Apify contract/credential isolation/monthly ceiling, safe pre-submission download recovery, `shareNow`, uncertain mutations, both-channel success, token expiry, ranges/HEAD and orphan cleanup. Additional cases verify the website's observed URL encoding, isolated provider request formats, configured sequential order, original CDN preference, no credential/cookie forwarding, unknown/disabled providers, HTML/CAPTCHA/fake MP4 rejection before selection, unsafe redirects, bounded metadata, strict result parsing without eval, overall deadline and both-channel creation once through a free fallback. No real account posting happens in these tests.

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

This proves actual download and publication for the permitted test Reel, using local resolution plus Worker download/publishing. It does **not** establish fully autonomous Worker-only resolution for future link-only shares: all four website adapters still have the egress limitations above. The optional Apify adapter is configured, but `DOWNLOADER_API_KEY` has not been installed. No paid product was enabled and Meta remains unpublished.
