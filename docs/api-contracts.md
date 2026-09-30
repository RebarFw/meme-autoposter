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
- [Conversations API](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/conversations-api): `GET /me/conversations?platform=instagram` requires `instagram_business_basic` and `instagram_business_manage_messages`. `npm run meta:diagnose` checks this read with `fields=id&limit=1` and discards conversation IDs. HTTP 200 with a list verifies messaging authorization; the diagnostic does not claim to enumerate scopes. A live request confirmed Instagram Login rejects `/me/permissions` (code 100), and the Instagram user token cannot authorize `/debug_token` (code 10).
- `npm run meta:diagnose` and `npm run meta:subscribe` run protected diagnostics without a Buffer key. Account subscription success proves that request was accepted, not production access or actual notification delivery. The messaging guide describes Standard Access for owned/managed/test accounts; the webhook setup guide lists Live/Advanced requirements for app-user notification access. Do not equate either generic documentation statement with the cause of a particular dashboard error without the actual API response.
- Live diagnosis on 2026-09-30: the actual Instagram Login dashboard showed the correct callback, `messages` subscribed, the connected account subscription On, and “To receive webhooks, your app must be in published state.” A pending setup DM was read through `GET /me/conversations`, `GET /<CONVERSATION_ID>?fields=messages.limit(20){id,created_time}`, and `GET /<MESSAGE_ID>?fields=created_time,from,to,message`; code equality and recipient matching were confirmed without returning content or IDs. The protected `owner:diagnose` keeps this read-only check bounded to 10 conversations and 20 recent message detail reads and does not authorize a sender.
- On 2026-10-01, after securely installing the regenerated Instagram app secret as `META_APP_SECRET`, a real dashboard `messages` test reached the deployed Worker with `X-Hub-Signature-256`, passed HMAC validation and returned HTTP 200. An unsigned POST still returned HTTP 403. D1 status confirmed zero jobs and deliveries. Signed irrelevant/sample events are acknowledged during setup; the operator's approved Reel still receives a retryable failure if publication configuration is unavailable. No app publication or App Review was performed.

## Workers request behavior

- [Cloudflare Request](https://developers.cloudflare.com/workers/runtime-apis/request/): Workers supports `redirect: 'manual'` and `'follow'`. Authenticated provider requests use `manual`, reject non-2xx responses and never forward credentials to redirect destinations. A live diagnostic exposed that `redirect: 'error'` throws before making a request in the deployed runtime.

## Cloudflare

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/): 10ms CPU per Free invocation, 128MB memory, background HTTP work approximately 30 seconds. Stream videos and persist jobs before processing.
- [Pricing](https://developers.cloudflare.com/workers/platform/pricing/): Workers Free and D1 free allowances. No paid infrastructure is enabled here.
- [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/): private binding upload/download/delete, object metadata, range retrieval. Fixed-length upload stream prevents unknown-length and oversized upload issues.
- [R2 lifecycle](https://developers.cloudflare.com/r2/buckets/object-lifecycles/): independent expiry fallback can target only our prefix.
- [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/): current `@cloudflare/vitest-plugin` with Vitest 4.1+, local runtime integration and D1 migration helpers.
