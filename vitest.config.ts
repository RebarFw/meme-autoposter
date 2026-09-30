import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const migrations = await readD1Migrations('./migrations');
export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.jsonc' },
    miniflare: { compatibilityFlags: ['nodejs_compat'], bindings: { TEST_MIGRATIONS: migrations, ADMIN_TOKEN: 'test-admin', META_APP_SECRET: 'test-app-secret', META_VERIFY_TOKEN: 'test-verify', OWNER_IG_SENDER_ID: '111', INGEST_MODE: 'webhook', PUBLIC_BASE_URL: 'https://worker.example' } },
  })],
  test: {
    setupFiles: ['./tests/setup.ts'],
  },
});
