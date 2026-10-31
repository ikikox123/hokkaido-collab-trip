// Download a full copy (trip + bcrypt account rows) from the Worker.
// Usage: ADMIN_TOKEN=... node scripts/export.mjs https://<your-worker>.workers.dev [outDir]
// Writes state.json and users.json. Keep them out of git; users.json holds password hashes.
import fs from 'node:fs';
import path from 'node:path';

const [base, outDir = '.'] = process.argv.slice(2);
const token = process.env.ADMIN_TOKEN;
if (!base || !token) {
  console.error('Usage: ADMIN_TOKEN=... node scripts/export.mjs <baseUrl> [outDir]');
  process.exit(1);
}
const USER_AGENT = 'hokkaido-trip-scripts/1.0 (+https://github.com/ikikox123)'; // Cloudflare answers 1010 to some default script UAs
const res = await fetch(new URL('/api/admin/export', base), { headers: { 'user-agent': USER_AGENT, authorization: `Bearer ${token}` } });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Export failed (${res.status}): ${body.error || 'unknown error'}`);
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'state.json'), `${JSON.stringify(body.state, null, 2)}\n`);
fs.writeFileSync(path.join(outDir, 'users.json'), `${JSON.stringify({ users: body.users }, null, 2)}\n`, { mode: 0o600 });
console.log(`Wrote state.json and users.json to ${path.resolve(outDir)}`);
