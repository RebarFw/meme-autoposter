import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(configChange, args = ['deploy', '--dry-run']) {
  const root = mkdtempSync(join(tmpdir(), 'english-autoposter-test-'));
  try {
    const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
    configChange?.(config);
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'node_modules', 'wrangler', 'bin'), { recursive: true });
    writeFileSync(join(root, 'wrangler.jsonc'), JSON.stringify(config));
    writeFileSync(join(root, 'scripts', 'wrangler.mjs'), readFileSync('scripts/wrangler.mjs'));
    writeFileSync(join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'), "console.log(JSON.stringify({account:process.env.CLOUDFLARE_ACCOUNT_ID,args:process.argv.slice(2)}));");
    return spawnSync(process.execPath, ['scripts/wrangler.mjs', ...args], {
      cwd: root, encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: 'wrong-inherited-account' },
    });
  } finally {
    const target = resolve(root);
    if (dirname(target) === resolve(tmpdir()) && basename(target).startsWith('english-autoposter-test-')) rmSync(target, { recursive: true, force: true });
  }
}

test('pins deployment commands to the English account instead of an inherited account', () => {
  const result = fixture();
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { account: '97d19512e831722d5d48aa2d05086716', args: ['deploy', '--dry-run'] });
});

test('rejects an altered account before invoking Wrangler', () => {
  const result = fixture(config => { config.account_id = 'different-account'; });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /English project\/account isolation check failed/);
  assert.equal(result.stdout, '');
});

test('rejects Arabic resource commands before invoking Wrangler', () => {
  const result = fixture(undefined, ['delete', 'arabic-meme-autoposter']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /English project\/account isolation check failed/);
  assert.equal(result.stdout, '');
});
