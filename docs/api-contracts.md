# Verified API contracts

Checked against official documentation on 2026-09-30. Meta's documentation was also fetched directly to resolve moved pages and current payload examples. This app targets **Instagram API with Instagram Login**.

## Buffer

- [Getting started](https://developers.buffer.com/guides/getting-started.html): GraphQL endpoint `https://api.buffer.com`, bearer API key.
- [Reference](https://developers.buffer.com/reference.html): `account.organizations`, `channels(input: {organizationId})`, channel `service` values `instagram`/`tiktok`, `isDisconnected`, `isLocked`, `TiktokMetadata.defaultToReminders`.
- [Video example](https://developers.buffer.com/examples/create-video-post.html): `assets: [{video: {url}}]`; no custom thumbnail URL.
- [Post scheduling](https://developers.buffer.com/guides/posts-and-scheduling.html) and reference: `createPost(input: CreatePostInput!)`, `mode: shareNow`, `schedulingType: automatic`, Instagram metadata `type: reel`, `shouldShareToFeed: true`. Current reference includes required `needsApproval`; explicitly set false.
- Reference: handle `PostActionSuccess` and `MutationError`; inspect returned post ID/status. Query `post(input: {id})`, and require `sent` on both before successful completion. Accepted `scheduled`/`sending` statuses do not imply published. `draft`, `needs_approval`, `error` or notification publishing are failures for this workflow.
- [Rate limits](https://developers.buffer.com/guides/api-limits.html): Free 100 calls/15 minutes, 250/24 hours, 3,000/30 days, shared with other use of the personal key.
- No documented create idempotency key: never replay an ambiguous create. The repo does not use the obsolete `/1/updates/create.json` REST endpoint.

## Meta

- [Webhook setup](https://developers.facebook.com/documentation/instagram-platform/webhooks/setup): GET handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`), SHA-256 signature using raw payload plus app secret, `X-Hub-Signature-256` prefix `sha256=`. Retry-safe durable acknowledgement is necessary.
- [Current payload examples](https://developers.facebook.com/documentation/instagram-platform/webhooks/examples): `object: instagram`, `entry[].messaging[]`, sender/recipient IDs, timestamp and `message.mid`. Supported Reel types include `ig_reel`/`reel`; uploaded videos and stories are separate types. Reject echoes, self-testing, deletion and unsupported messages.
- [Attachment transition](https://developers.facebook.com/docs/instagram-platform/webhooks/new): support `ig_post` with `ig_post_media_id`, title and URL; historical legacy `share` can coexist. Do not create separate jobs for both attachments.
- [Send messages](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api): `graph.instagram.com`, Instagram User token, `instagram_business_basic`, `instagram_business_manage_messages`; recipient must have initiated the conversation; standard 24-hour window. Permission to repost is not permission to read arbitrary third-party Graph media.
- [IG Media](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-media): `media_type`, `media_product_type`, `media_url`, `permalink`; media URL is optional and may be withheld. Require Reel/video evidence.
- [Graph changelog](https://developers.facebook.com/docs/graph-api/changelog): current version v26.0 released July 29, 2026. Version is configurable in `META_API_VERSION`.
- Webhook setup distinguishes app field selection from account-level `POST /<INSTAGRAM_ACCOUNT_ID>/subscribed_apps`. `npm run setup` performs the account subscription once a valid Meta token is installed.

## Cloudflare

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 10ms CPU per Free invocation, 128MB memory, background HTTP work approximately 30 seconds. Stream videos and persist jobs before processing.
- [Pricing](https://developers.cloudflare.com/workers/platform/pricing/): Workers Free and D1 free allowances. No paid infrastructure is enabled here.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): private binding upload/download/delete, object metadata, range retrieval. Fixed-length upload stream prevents unknown-length and oversized upload issues.
- [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/): independent expiry fallback can target only our prefix.
- [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/): current `@cloudflare/vitest-plugin` with Vitest 4.1+, local runtime integration and D1 migration helpers.
