import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function wrangler(args, options = {}) {
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  const accountId = '97d19512e831722d5d48aa2d05086716';
  if (config.account_id !== accountId || config.vars.CLOUDFLARE_ACCOUNT_ID !== accountId || config.name !== 'meme-autoposter' || config.r2_buckets?.[0]?.bucket_name !== 'meme-autoposter-media' || config.d1_databases?.[0]?.database_name !== 'meme-autoposter-jobs' || args.some(arg => /arabic-meme-autoposter/.test(arg))) throw new Error('English project/account isolation check failed');
  const cli = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
  const result = spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId, WRANGLER_SEND_METRICS: 'false' },
    stdio: options.capture || options.input ? ['pipe','pipe','pipe'] : 'inherit',
    ...(options.input ? { input: options.input } : {}),
  });
  if (result.status !== 0) {
    // Never print secret-bearing stdin. Wrangler output is suppressed for secret puts.
    if (options.capture && !options.input) console.error(result.stderr || result.stdout);
    throw new Error(`Wrangler ${args.slice(0,2).join(' ')} failed`);
  }
  return result.stdout ?? '';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { wrangler(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
