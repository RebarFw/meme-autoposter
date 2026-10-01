# Verification

## Automated checks

`npm run check` runs lint, typecheck and Workers-runtime integration tests. All 84 tests passed on 2026-10-01. Local D1/R2 bindings are real; external Buffer/Meta HTTP requests are mocked. Cases cover signature rejection, exact sender/recipient matching, stale/echo/deleted events, unsafe URLs, current/legacy and live-observed link-only shares, polling concurrency/backoff/activation cutoff, unchanged conversation timestamps, authenticated sender import, parser upgrades, atomic duplicate leases, MP4 bounds/type checks, the optional Apify contract/credential isolation/monthly ceiling, safe pre-submission download recovery, `shareNow`, uncertain mutations, both-channel success, token expiry, ranges/HEAD and orphan cleanup. Additional cases verify the website's observed URL encoding, isolated provider request formats, configured sequential order, original CDN preference, no credential/cookie forwarding, unknown/disabled providers, HTML/CAPTCHA/fake MP4 rejection before selection, unsafe redirects, bounded metadata, strict result parsing without eval, overall deadline and both-channel creation once through a free fallback. No real account posting happens in these tests.

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

Probes returned fixed facts/errors only, never sent account credentials to these sites, executed no returned scripts, solved no CAPTCHA, wrote no R2 media and created no Buffer post. The same original job remains `attention` with zero deliveries. A working Worker-compatible provider still needs to be established before retrying that job or declaring live publishing complete.
