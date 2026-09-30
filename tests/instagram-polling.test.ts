import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseApiMessage } from '../src/instagram-api';
import { pollInstagram, pollingStatus } from '../src/instagram-polling';
import { importOwnerSetup } from '../src/owner-setup';
import { saveSetting, settings } from '../src/jobs';
import { sha256 } from '../src/security';
import worker from '../src/index';
import type { Channel, Env } from '../src/types';

const bindings = (): Env => ({ ...env, INGEST_MODE: 'polling', META_ACCESS_TOKEN: 'fake-meta', BUFFER_API_KEY: 'fake-buffer' });
const channels: Channel[] = [
  { id: 'ig', name: 'memes', service: 'instagram', serviceId: '222', organizationId: 'org', isDisconnected: false, isLocked: false },
  { id: 'tt', name: 'memes', service: 'tiktok', serviceId: '333', organizationId: 'org', isDisconnected: false, isLocked: false },
];
const mp4 = new Uint8Array([0,0,0,24,102,116,121,112,105,115,111,109,0,0,0,0,105,115,111,109,109,112,52,50]);
const message = (overrides: Record<string, unknown> = {}) => ({
  id: 'message-1', created_time: new Date(Date.now() - 1000).toISOString(), from: { id: '111', username: 'owner' }, to: { data: [{ id: '444' }] }, message: '',
  shares: { data: [{ type: 'ig_reel', id: 'media-1', url: 'https://lookaside.fbsbx.com/reel.mp4', name: 'clip' }] }, ...overrides,
});
async function countJobs() { return (await env.DB.prepare('SELECT COUNT(*) AS n FROM jobs').first<{ n: number }>())!.n; }
async function due() { await env.DB.prepare("UPDATE settings SET value=json_set(value,'$.nextAt',0) WHERE key='instagram_poll'").run(); }

function mockApi(items = [message()]) {
  let creates = 0;
  const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.includes('/me?')) return Response.json({ id: '444', user_id: '222', username: 'memes' });
    if (url.includes('/me/conversations?')) return Response.json({ data: [{ id: 'conversation-1', updated_time: 'version-1' }] });
    if (url.includes('/conversation-1?')) return Response.json({ messages: { data: items.map(m => ({ id: m.id, created_time: m.created_time })) } });
    const found = items.find(item => url.includes('/' + item.id + '?'));
    if (found) return Response.json(found);
    if (url.includes('fbsbx.com')) return new Response(mp4, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(mp4.length) } });
    if (url === 'https://api.buffer.com') {
      const body = JSON.parse(String(init?.body));
      expect(body.variables.input.mode).toBe('shareNow');
      return Response.json({ data: { createPost: { __typename: 'PostActionSuccess', post: { id: 'post-' + ++creates, status: 'sending', schedulingType: 'automatic' } } } });
    }
    throw new Error('Unexpected request');
  });
  return { fetcher, creates: () => creates };
}
beforeEach(async () => {
  await env.DB.batch([env.DB.prepare('DELETE FROM deliveries'), env.DB.prepare('DELETE FROM jobs'), env.DB.prepare('DELETE FROM settings')]);
  await saveSetting(env, 'channels', channels);
  await saveSetting(env, 'recipient_ids', ['222', '444']);
  await saveSetting(env, 'instagram_poll', { startedAt: Date.now() - 60_000, seen: [], versions: {} });
});
afterEach(() => vi.restoreAllMocks());

describe('Meta API message parsing', () => {
  it('requires the exact owner, correct recipient and a new message, and canonicalizes the recipient', () => {
    const parsed = parseApiMessage(message(), '111', ['222', '444'], Date.now() - 60_000);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ recipientId: '222', messageId: 'message-1', kind: 'reel', mediaId: 'media-1' });
    expect(parseApiMessage(message(), '999', ['222', '444'], 0)).toEqual([]);
    expect(parseApiMessage(message(), '111', ['555'], 0)).toEqual([]);
    expect(parseApiMessage(message(), '111', ['222', '444'], Date.now())).toEqual([]);
  });
  it('ignores uploaded videos, stories, unsafe URLs and ambiguous multiple shares', () => {
    expect(parseApiMessage(message({ shares: {}, attachments: { data: [{ video_data: { url: 'https://lookaside.fbsbx.com/upload.mp4' } }] } }), '111', ['444'], 0)).toEqual([]);
    expect(parseApiMessage(message({ shares: { data: [{ type: 'story', url: 'https://lookaside.fbsbx.com/a' }] } }), '111', ['444'], 0)).toEqual([]);
    expect(parseApiMessage(message({ shares: { data: [{ type: 'reel', url: 'https://evil.example/video' }] } }), '111', ['444'], 0)).toEqual([]);
    expect(parseApiMessage(message({ shares: { data: [{ type: 'reel', id: 'a', url: 'https://lookaside.fbsbx.com/a' }, { type: 'reel', id: 'b', url: 'https://lookaside.fbsbx.com/b' }] } }), '111', ['444'], 0)).toEqual([]);
  });
});

describe('durable owner-only polling', () => {
  it('creates both immediate posts once and avoids detail reads for an unchanged conversation', async () => {
    const api = mockApi();
    await pollInstagram(bindings());
    expect(api.creates()).toBe(2);
    expect(await countJobs()).toBe(1);
    expect((await pollingStatus(bindings())).received).toBe(1);
    api.fetcher.mockClear();
    await due();
    await pollInstagram(bindings());
    expect(api.creates()).toBe(2);
    expect(api.fetcher).toHaveBeenCalledTimes(2);
    expect(new URL(String(api.fetcher.mock.calls[0]![0])).searchParams.get('user_id')).toBe('111');
  });
  it('leases polling atomically so simultaneous invocations do not duplicate API reads or posts', async () => {
    const api = mockApi();
    await Promise.all(Array.from({ length: 5 }, () => pollInstagram(bindings())));
    expect(api.creates()).toBe(2);
    expect(api.fetcher.mock.calls.filter(([url]) => String(url).includes('/me/conversations?'))).toHaveLength(1);
  });
  it('finds a new DM even when the conversation updated_time has not changed', async () => {
    const items = [message()];
    const api = mockApi(items);
    await pollInstagram(bindings());
    items.push(message({ id: 'message-2' }));
    api.fetcher.mockClear();
    await due();
    await pollInstagram(bindings());
    expect(api.creates()).toBe(4);
    expect(await countJobs()).toBe(2);
    const details = api.fetcher.mock.calls.filter(([url]) => /\/message-\d\?/.test(String(url)));
    expect(details).toHaveLength(1);
    expect(String(details[0]![0])).toContain('/message-2?');
  });
  it('ignores stranger DMs even if Meta returns them in the owner-filtered conversation', async () => {
    const api = mockApi([message({ from: { id: '999', username: 'stranger' } })]);
    await pollInstagram(bindings());
    expect(await countJobs()).toBe(0);
    expect(api.creates()).toBe(0);
  });
  it('starts at activation and never posts old history or future-dated messages', async () => {
    const api = mockApi([message({ created_time: new Date(Date.now() - 3600_000).toISOString() }), message({ id: 'future', created_time: new Date(Date.now() + 3600_000).toISOString() })]);
    await pollInstagram(bindings());
    expect(await countJobs()).toBe(0);
    expect(api.creates()).toBe(0);
  });
  it('backs off on API failure without consuming a message or losing durable configuration', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 429 }));
    await pollInstagram(bindings());
    expect((await pollingStatus(bindings())).lastErrorCode).toBe('meta_http_429');
    expect((await pollingStatus(bindings())).nextAt).toBeGreaterThan(Date.now() + 100_000);
    await pollInstagram(bindings());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await countJobs()).toBe(0);
  });
  it('cannot fetch DMs or publish without configuration or in webhook mode', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const incomplete of [{ OWNER_IG_SENDER_ID: undefined }, { BUFFER_API_KEY: undefined }, { INGEST_MODE: 'webhook' as const }]) {
      await pollInstagram({ ...bindings(), ...incomplete });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(await countJobs()).toBe(0);
  });
  it('acknowledges a signed webhook without creating a second ingestion path in polling mode', async () => {
    const body = JSON.stringify({ object: 'instagram', entry: [{ id: '222', messaging: [{ sender: { id: '111' }, recipient: { id: '222' }, timestamp: Date.now(), message: { mid: 'message-1', attachments: [{ type: 'reel', payload: { url: 'https://lookaside.fbsbx.com/reel.mp4' } }] } }] }] });
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('test-app-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hash = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
    const signature = 'sha256=' + [...hash].map(n => n.toString(16).padStart(2, '0')).join('');
    const ctx = createExecutionContext();
    const response = await worker.fetch(new Request('https://worker.example/webhooks/instagram', { method: 'POST', body, headers: { 'x-hub-signature-256': signature } }), bindings(), ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(200);
    expect(await countJobs()).toBe(0);
  });
});

describe('authenticated API owner identification', () => {
  const code = 'meme-setup:' + 'a'.repeat(64);
  const selection = async () => ({ username: 'owner', challengeHash: await sha256(code) });
  it('identifies the selected sender from the exact setup DM without publishing and preserves the proof only until secret installation', async () => {
    const api = mockApi([message({ message: code, created_time: new Date(Date.now() - 20 * 60_000).toISOString() })]);
    const result = await importOwnerSetup({ ...bindings(), OWNER_IG_SENDER_ID: undefined }, await selection());
    expect(result).toEqual({ matched: true, verifiedBy: 'api', username: 'owner' });
    const proof = await settings<{ senderId: string; verifiedBy: string }>(bindings(), 'owner_setup');
    expect(proof?.senderId).toBe('111');
    expect(proof?.verifiedBy).toBe('api');
    expect(JSON.stringify(proof)).not.toContain(code);
    expect(await countJobs()).toBe(0);
    expect(api.creates()).toBe(0);
  });
  it('requires username, code and recipient to match and never rebinds an installed owner', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    await expect(importOwnerSetup(bindings(), await selection())).rejects.toThrow('owner_already_configured');
    expect(fetcher).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    for (const overrides of [{ from: { id: '999', username: 'stranger' } }, { message: 'wrong' }, { to: { data: [{ id: '555' }] } }]) {
      mockApi([message({ message: code, ...overrides })]);
      await expect(importOwnerSetup({ ...bindings(), OWNER_IG_SENDER_ID: undefined }, await selection())).rejects.toThrow('owner_api_proof_not_found');
      vi.restoreAllMocks();
    }
    expect(await settings(bindings(), 'owner_setup')).toBeNull();
  });
  it('protects owner import and polling controls with admin authorization', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    for (const [path, method] of [['owner/import', 'POST'], ['poll', 'POST'], ['poll/validate', 'GET']]) {
      const ctx = createExecutionContext();
      const response = await worker.fetch(new Request('https://worker.example/admin/' + path, { method }), bindings(), ctx);
      expect(response.status).toBe(401);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
});
