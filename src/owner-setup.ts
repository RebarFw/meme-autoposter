import { metaRequest } from './meta';
import { saveSetting, settings } from './jobs';
import { constantTimeEqual, sha256 } from './security';
import { AppError, log, type Env } from './types';

interface OwnerSetup {
  hash: string;
  createdAt: number;
  expiresAt: number;
  recipients: string[];
  senderId: string | null;
  matchedAt: number | null;
}
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const identifier = (value: unknown): string | undefined => typeof value === 'string' && /^\d{1,40}$/.test(value) ? value : undefined;

export async function startOwnerSetup(env: Env) {
  if (env.OWNER_IG_SENDER_ID) throw new AppError('owner_already_configured');
  if (!env.META_APP_SECRET) throw new AppError('missing_meta_app_secret');
  const response = await metaRequest<Record<string, unknown>>(env, 'me?fields=id,user_id,username');
  const me = Array.isArray(response.data) ? object(response.data[0]) : response;
  const recipients = [...new Set([identifier(me.user_id), identifier(me.id)].filter((id): id is string => !!id))];
  if (!recipients.length || typeof me.username !== 'string' || !/^[A-Za-z0-9._]{1,40}$/.test(me.username)) throw new AppError('invalid_instagram_account');
  const message = 'meme-setup:' + crypto.randomUUID().replaceAll('-', '') + crypto.randomUUID().replaceAll('-', '');
  const now = Date.now();
  await saveSetting(env, 'owner_setup', { hash: await sha256(message), createdAt: now, expiresAt: now + 15 * 60_000, recipients, senderId: null, matchedAt: null } satisfies OwnerSetup);
  return { username: me.username, message, expiresAt: now + 15 * 60_000 };
}

// Call only AFTER validating Meta's signature. The random one-time DM is an
// explicit authorization from the personal account chosen by the operator.
export async function acceptOwnerSetup(env: Env, payload: unknown): Promise<boolean> {
  if (env.OWNER_IG_SENDER_ID) return false;
  const pending = await settings<OwnerSetup>(env, 'owner_setup');
  const now = Date.now();
  if (!pending || pending.expiresAt <= now) return false;
  const root = object(payload);
  if (root.object !== 'instagram' || !Array.isArray(root.entry)) return false;
  let candidates = 0;
  for (const rawEntry of root.entry.slice(0, 100)) {
    const entry = object(rawEntry);
    if (!Array.isArray(entry.messaging)) continue;
    for (const rawEvent of entry.messaging.slice(0, 100)) {
      const event = object(rawEvent);
      const senderId = identifier(object(event.sender).id);
      const recipientId = identifier(object(event.recipient).id);
      const message = object(event.message);
      const text = typeof message.text === 'string' ? message.text.trim() : '';
      if (!senderId || !recipientId || senderId === recipientId || !pending.recipients.includes(recipientId) || entry.id !== recipientId || message.is_echo || message.is_self || message.is_deleted || message.is_unsupported || typeof message.mid !== 'string' || !/^[\x21-\x7e]{1,512}$/.test(message.mid)) continue;
      if (typeof event.timestamp !== 'number' || !Number.isFinite(event.timestamp) || event.timestamp < pending.createdAt - 30_000 || event.timestamp > now + 300_000) continue;
      if (!/^meme-setup:[a-f0-9]{64}$/.test(text)) continue;
      if (++candidates > 8) return false;
      if (!await constantTimeEqual(await sha256(text), pending.hash)) continue;
      if (pending.senderId) return pending.senderId === senderId;
      // Exactly one sender wins, even for simultaneous deliveries. It is NOT
      // added to the posting allowlist until the local authenticated installer
      // puts this verified ID into the Cloudflare OWNER_IG_SENDER_ID secret.
      const result = await env.DB.prepare(`UPDATE settings SET value=json_set(value, '$.senderId', ?, '$.matchedAt', ?)
        WHERE key='owner_setup' AND json_extract(value, '$.hash')=?
        AND json_extract(value, '$.senderId') IS NULL AND json_extract(value, '$.expiresAt')>?`)
        .bind(senderId, now, pending.hash, now).run();
      if (result.meta.changes) log('owner_setup_verified');
      return !!result.meta.changes;
    }
  }
  return false;
}

export async function ownerSetupStatus(env: Env) {
  const pending = await settings<OwnerSetup>(env, 'owner_setup');
  if (!pending || pending.expiresAt <= Date.now()) return { matched: false, expired: true };
  return { matched: !!pending.senderId, expired: false, senderId: pending.senderId ?? undefined, matchedAt: pending.matchedAt ?? undefined, expiresAt: pending.expiresAt };
}

export async function finishOwnerSetup(env: Env): Promise<void> {
  const pending = await settings<OwnerSetup>(env, 'owner_setup');
  if (!pending?.senderId || !env.OWNER_IG_SENDER_ID || !await constantTimeEqual(pending.senderId, env.OWNER_IG_SENDER_ID)) throw new AppError('owner_installation_not_confirmed');
  await env.DB.prepare("DELETE FROM settings WHERE key='owner_setup'").run();
}
