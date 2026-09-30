import { readFileSync } from 'node:fs';

try {
  const config = JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  const command = process.argv[2];
  if (!['setup','status'].includes(command)) throw new Error('Use npm run setup or npm run status.');
  const token = readFileSync('.secrets/admin-token','utf8').trim();
  const response = await fetch(`${config.vars.PUBLIC_BASE_URL}/admin/${command}`, { method: command === 'setup' ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Admin request failed.');
  console.log(JSON.stringify(result,null,2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
