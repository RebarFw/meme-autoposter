import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { wrangler } from './wrangler.mjs';

try {
  const auth = wrangler(['whoami'], { capture: true });
  if (auth.includes('not authenticated')) throw new Error('Run npx wrangler login, then retry npm run deploy.');
  // The existing bucket must exist. This script never creates or enables a paid product.
  wrangler(['r2','bucket','info','meme-autoposter-media'], { capture: true });
  const lifecycle = wrangler(['r2','bucket','lifecycle','list','meme-autoposter-media'], { capture: true });
  if (!lifecycle.includes('meme-autoposter-expiry-2d')) {
    wrangler(['r2','bucket','lifecycle','add','meme-autoposter-media','meme-autoposter-expiry-2d','meme-autoposter/','--expire-days','2','--force']);
  }
  const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  if (config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') {
    const databases = JSON.parse(wrangler(['d1','list','--json'], { capture: true }));
    let db = databases.find(d => d.name === 'meme-autoposter-jobs');
    if (!db) {
      wrangler(['d1','create','meme-autoposter-jobs']);
      db = JSON.parse(wrangler(['d1','list','--json'], { capture: true })).find(d => d.name === 'meme-autoposter-jobs');
    }
    if (!db?.uuid) throw new Error('D1 database was not found after creation.');
    config.d1_databases[0].database_id = db.uuid;
    writeFileSync('wrangler.jsonc', JSON.stringify(config,null,2) + '\n');
  }
  wrangler(['d1','migrations','apply','meme-autoposter-jobs','--remote']);
  const output = wrangler(['deploy'], { capture: true });
  console.log(output);
  const url = output.match(/https:\/\/[a-z0-9.-]+\.workers\.dev\b/)?.[0];
  if (!url) throw new Error('Worker deployed but workers.dev URL is unavailable.');
  if (config.vars.PUBLIC_BASE_URL !== url) {
    config.vars.PUBLIC_BASE_URL = url;
    writeFileSync('wrangler.jsonc',JSON.stringify(config,null,2) + '\n');
    wrangler(['deploy']);
  }
  mkdirSync('.secrets',{ recursive: true });
  const tokenPath = '.secrets/admin-token';
  if (!existsSync(tokenPath)) writeFileSync(tokenPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  wrangler(['secret','put','ADMIN_TOKEN'], { input: readFileSync(tokenPath,'utf8') });
  const verifyPath = '.secrets/meta-verify-token';
  if (!existsSync(verifyPath)) writeFileSync(verifyPath, randomBytes(32).toString('hex'), { mode: 0o600 });
  wrangler(['secret','put','META_VERIFY_TOKEN'], { input: readFileSync(verifyPath,'utf8') });
  mkdirSync('.local',{ recursive: true });
  writeFileSync('.local/deployment.json', JSON.stringify({ url, webhook: `${url}/webhooks/instagram` },null,2));
  const health = await fetch(`${url}/health`);
  if (!health.ok || !(await health.json()).ok) throw new Error('Deployed health check failed.');
  const verify = new URL(`${url}/webhooks/instagram`);
  verify.searchParams.set('hub.mode','subscribe');
  verify.searchParams.set('hub.challenge','deployment-check');
  verify.searchParams.set('hub.verify_token',readFileSync(verifyPath,'utf8'));
  const handshake = await fetch(verify);
  if (!handshake.ok || await handshake.text() !== 'deployment-check') throw new Error('Deployed Meta verification failed.');
  console.log(`Verified health: ${url}/health\nMeta callback URL: ${url}/webhooks/instagram`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
