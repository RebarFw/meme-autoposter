import { BufferClient } from './buffer';
import { enqueue, maintenance, processJob, saveSetting, settings } from './jobs';
import { metaRequest, parseMessages } from './meta';
import { diagnoseMeta } from './meta-diagnostics';
import { serveMedia } from './media';
import { privacyResponse } from './privacy';
import { constantTimeEqual, limitedBytes, validSignature } from './security';
import { AppError, errorCode, log, type Channel, type Env } from './types';

const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });

async function admin(request: Request, env: Env, path: string): Promise<Response> {
  const auth = request.headers.get('authorization') ?? '';
  if (!env.ADMIN_TOKEN || !auth.startsWith('Bearer ') || !await constantTimeEqual(auth.slice(7), env.ADMIN_TOKEN)) return json({ error: 'unauthorized' }, 401);
  if (path === '/admin/meta/diagnose' && request.method === 'GET') return json(await diagnoseMeta(env));
  if (path === '/admin/meta/subscribe' && request.method === 'POST') return json(await diagnoseMeta(env, true));
  if (path === '/admin/setup' && request.method === 'POST') {
    const channels = await new BufferClient(env).discoverChannels();
    let recipients = [channels[0].serviceId];
    if (env.META_ACCESS_TOKEN) {
      const me = await metaRequest<{ id?: string; user_id?: string; username?: string }>(env, 'me?fields=id,user_id,username');
      if (!me.username || me.username.toLowerCase().replace(/^@/, '') !== channels[0].name.toLowerCase().replace(/^@/, '')) throw new AppError('meta_buffer_account_mismatch');
      recipients = [...new Set([me.user_id, me.id, channels[0].serviceId].filter((id): id is string => !!id))];
    }
    if (recipients.some(id => !/^\d+$/.test(id))) throw new AppError('invalid_instagram_account_id');
    await saveSetting(env, 'channels', channels);
    await saveSetting(env, 'recipient_ids', recipients);
    if (env.META_ACCESS_TOKEN) {
      const subscription = await metaRequest<{ success?: boolean }>(env, `${encodeURIComponent(recipients[0]!)}/subscribed_apps`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'subscribed_fields=messages',
      });
      if (!subscription.success) throw new AppError('meta_subscription_failed');
    }
    return json({ channels: channels.map(c => ({ service: c.service, id: c.id, name: c.name })), recipients, metaSubscribed: !!env.META_ACCESS_TOKEN, webhook: `${env.PUBLIC_BASE_URL}/webhooks/instagram` });
  }
  if (path === '/admin/status' && request.method === 'GET') {
    const jobs = await env.DB.prepare('SELECT id,state,error_code,created_at,updated_at FROM jobs ORDER BY created_at DESC LIMIT 20').all();
    const deliveryRows = await env.DB.prepare('SELECT job_id,service,state,post_id,post_status,error_code FROM deliveries WHERE job_id IN (SELECT id FROM jobs ORDER BY created_at DESC LIMIT 20)').all();
    return json({ configured: { buffer: !!env.BUFFER_API_KEY, metaSecret: !!env.META_APP_SECRET, metaAccess: !!env.META_ACCESS_TOKEN, owner: !!env.OWNER_IG_SENDER_ID, channels: !!await settings<Channel[]>(env,'channels') }, jobs: jobs.results, deliveries: deliveryRows.results });
  }
  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/privacy' || path === '/privacy/') return privacyResponse(request.method);
      if (path === '/health' && ['GET','HEAD'].includes(request.method)) return json({ ok: true, service: 'meme-autoposter' });
      if (path.startsWith('/admin/')) return await admin(request, env, path);
      const media = /^\/media\/([a-f0-9]{64})\.mp4$/.exec(path);
      if (media && ['GET','HEAD'].includes(request.method)) return await serveMedia(request, env, media[1]!);
      if (path !== '/webhooks/instagram') return json({ error: 'not_found' },404);
      if (request.method === 'GET') {
        const params = new URL(request.url).searchParams;
        const token = params.get('hub.verify_token') ?? '';
        const challenge = params.get('hub.challenge');
        if (!env.META_VERIFY_TOKEN) return json({ error: 'verification_not_configured' },503);
        if (params.get('hub.mode') !== 'subscribe' || !challenge || challenge.length > 1024 || !await constantTimeEqual(token, env.META_VERIFY_TOKEN)) return json({ error: 'forbidden' },403);
        return new Response(challenge, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } });
      }
      if (request.method !== 'POST') return json({ error: 'method_not_allowed' },405);
      if (!env.META_APP_SECRET) return json({ error: 'signature_not_configured' },503);
      if (Number(request.headers.get('content-length')) > 256_000) return json({ error: 'body_too_large' },413);
      const body = await limitedBytes(request.body, 256_000);
      if (!await validSignature(body, request.headers.get('x-hub-signature-256'), env.META_APP_SECRET)) return json({ error: 'invalid_signature' },403);
      let payload: unknown;
      try { payload = JSON.parse(new TextDecoder().decode(body)); } catch { return json({ error: 'invalid_json' },400); }
      const recipients = await settings<string[]>(env, 'recipient_ids');
      if (!env.OWNER_IG_SENDER_ID || !env.BUFFER_API_KEY || !env.PUBLIC_BASE_URL || !recipients || env.REPOST_PERMISSION_CONFIRMED !== 'true') return json({ error: 'publishing_not_configured' },503);
      const sources = parseMessages(payload, env.OWNER_IG_SENDER_ID, recipients);
      // Acknowledge only after all jobs are durable. Meta retries are INSERT OR IGNORE.
      const jobIds: string[] = [];
      for (const source of sources) jobIds.push(await enqueue(env, source));
      if (jobIds.length) ctx.waitUntil((async () => {
        for (const jobId of [...new Set(jobIds)]) await processJob(env, jobId);
      })().catch(error => log('background_failed', { code: errorCode(error) })));
      return json({ received: true });
    } catch (error) {
      const code = errorCode(error);
      log('request_failed', { code });
      return json({ error: code }, code === 'body_too_large' ? 413 : 503);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(maintenance(env).catch(error => log('maintenance_failed', { code: errorCode(error) })));
  },
} satisfies ExportedHandler<Env>;
