import { readFileSync } from 'node:fs';

try {
  const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  const command = process.argv[2];
  const commands = { setup: { path: 'setup', method: 'POST' }, status: { path: 'status', method: 'GET' }, 'meta:diagnose': { path: 'meta/diagnose', method: 'GET' }, 'meta:subscribe': { path: 'meta/subscribe', method: 'POST' } };
  const operation = commands[command];
  if (!operation) throw new Error('Use setup, status, meta:diagnose or meta:subscribe.');
  const token = readFileSync('.secrets/admin-token','utf8').trim();
  const response = await fetch(`${config.vars.PUBLIC_BASE_URL}/admin/${operation.path}`, { method: operation.method, headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(60_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Admin request failed.');
  console.log(JSON.stringify(result,null,2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
