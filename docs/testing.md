# Verification

## Automated checks

`npm run check` runs lint, typecheck and Workers-runtime integration tests. Local D1/R2 bindings are real; external Buffer/Meta HTTP requests are mocked. Cases cover signature rejection, exact sender/recipient matching, stale/echo/deleted events, unsafe URLs, current/legacy shares, atomic duplicate leases, MP4 bounds/type checks, `shareNow`, uncertain mutations, both-channel success, token expiry, ranges/HEAD and orphan cleanup. No real account posting happens in these tests.

`npx wrangler deploy --dry-run --outdir dist` confirms the bundle and binding configuration. `npm run deploy` verifies remote health and GET webhook verification, but that does not establish messaging permissions or video download viability.

## Real acceptance test after setup

1. Keep Meta unpublished as requested; authorize owned accounts/testers; configure the callback and `messages` field. Enter Worker secrets securely, then run `npm run setup` and `npm run meta:diagnose`. Test the callback with Meta's dashboard synthetic test. The current Instagram Login dashboard explicitly requires a published app for real webhook notifications; successful API reads and account subscriptions do not bypass that condition. Do not publish the app or start App Review automatically.
2. After real webhook delivery has been enabled through an explicitly authorized Meta setup change, run `npm run owner:start`, send its one-time message from the approved personal account to the meme page, and run `npm run owner:finish` to install the verified sender securely. This tests real signed webhook delivery without creating posts. A pending DM can be checked separately with `npm run owner:diagnose`, which does not authorize a sender.
3. Share one short MP4 Reel that you own or have permission to repost from the approved personal account to the meme page. Record the D1 job hash using `npm run status`.
4. Confirm exactly one Buffer create per channel, both with immediate mode. Confirm both actual network posts, and final `completed` with both Buffer `sent` statuses.
5. Verify its R2 object is gone after both publications. Sending/retrying the same signed Meta event must leave the same job/post IDs.
6. DM another Reel from an unapproved test account. Confirm no new job and no Buffer post.
7. Test a shared image/story or random text. Confirm no publish. Test an inaccessible Reel; confirm a fixed error state and eventual cleanup.
8. If `no_downloader_could_resolve_reel` occurs, inspect the provider error codes first. A thumbnail-only native share may need a Reel permalink or a provider that can resolve Meta's supplied data. Never promise the native Share flow works before this real test.
9. Enable owner confirmation only after send-message permission works. Its success must mean both channels are actually `sent`.

## Scope of confidence

Mocked tests prove the local logic and API request shape against documented contracts. They cannot prove a particular key's scopes, Meta account roles, the shape of a real third-party share, Instagram's public page availability, Buffer's ingest timing, social-network video requirements, or Free-plan CPU behavior with a large real video. Inspect Worker metrics during the first live test. If actual CPU exceeds the Free allowance, investigate the stage before considering a paid plan; deployment does not upgrade automatically.
