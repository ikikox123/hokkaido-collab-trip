// Copy Railway's data/state.json and data/users.json into the Worker.
// Usage:
//   ADMIN_TOKEN=... node scripts/import.mjs https://<your-worker>.workers.dev path/to/state.json path/to/users.json [--force]
// ADMIN_TOKEN must match the Worker secret of the same name. Nothing is printed except counts.
import fs from 'node:fs';

const [base, statePath, usersPath, flag] = process.argv.slice(2);
const token = process.env.ADMIN_TOKEN;
if (!base || !statePath || !usersPath || !token) {
  console.error('Usage: ADMIN_TOKEN=... node scripts/import.mjs <baseUrl> <state.json> <users.json> [--force]');
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const users = JSON.parse(fs.readFileSync(usersPath, 'utf8'));
const res = await fetch(new URL('/api/admin/import', base), {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ state, users, force: flag === '--force' }),
});
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`Import failed (${res.status}): ${body.error || 'unknown error'}`);
  process.exit(1);
}
console.log(`Imported ${body.stops} stops and ${body.users} accounts.`);
