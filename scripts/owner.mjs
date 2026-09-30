import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { wrangler } from './wrangler.mjs';

try {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const admin = readFileSync('.secrets/admin-token', 'utf8').trim();
  async function request(action, method) {
    const response = await fetch(`${config.vars.PUBLIC_BASE_URL}/admin/owner/${action}`, { method, redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${admin}` } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'owner_setup_failed');
    return result;
  }
  const command = process.argv[2];
  if (command === 'start') {
    const result = await request('start', 'POST');
    console.log(JSON.stringify({ sendFrom: 'Your approved personal Instagram account', sendTo: '@' + result.username, message: result.message, expiresAt: new Date(result.expiresAt).toISOString() }, null, 2));
  } else if (command === 'diagnose') {
    console.log(JSON.stringify(await request('diagnose', 'GET'), null, 2));
  } else if (command === 'status') {
    const result = await request('status', 'GET');
    // The actual sender ID is returned only to the authenticated installer.
    console.log(JSON.stringify({ matched: result.matched, expired: result.expired, matchedAt: result.matchedAt, expiresAt: result.expiresAt }, null, 2));
  } else if (command === 'finish') {
    const result = await request('status', 'GET');
    if (!result.matched || result.expired || !/^\d{1,40}$/.test(result.senderId)) throw new Error('owner_dm_not_verified');
    wrangler(['secret', 'put', 'OWNER_IG_SENDER_ID'], { input: result.senderId, capture: true });
    // A secret update creates a new deployment; allow its environment to propagate.
    for (let attempt = 0; ; attempt++) {
      try { await request('finish', 'POST'); break; }
      catch (error) { if (attempt >= 3) throw error; await delay(1500); }
    }
    console.log('Verified personal sender securely installed as OWNER_IG_SENDER_ID; temporary setup proof removed.');
  } else throw new Error('Use npm run owner:start, owner:status, owner:diagnose or owner:finish.');
} catch (error) { console.error(error.message); process.exitCode = 1; }
