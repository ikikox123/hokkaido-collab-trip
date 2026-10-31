/**
 * Per-user "saved places" key for the iOS Shortcut. Shared by the Worker and its tests.
 *
 * Format: hks_<16 hex id>_<43 base64url chars = 32 random bytes>. The id only finds the row;
 * the secret is never stored. The database keeps SHA-256(secret) and the comparison is constant time.
 * A key works on POST /api/saved/ingest and nowhere else.
 */
export const KEY_PREFIX = 'hks_';
// 8-32 hex: keys made before the id grew to 16 hex still parse.
const KEY_PATTERN = /^hks_([0-9a-f]{8,32})_([A-Za-z0-9_-]{43})$/;

const encoder = new TextEncoder();

function toHex(bytes) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text) {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

/** XOR-accumulate over the whole length so a mismatch does not return early. */
export function constantTimeEqual(a, b) {
  const x = encoder.encode(String(a));
  const y = encoder.encode(String(b));
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Returns { key, keyId, hash }. `key` is shown to the user once and never stored. */
export async function generateSavedKey() {
  const keyId = toHex(crypto.getRandomValues(new Uint8Array(8)));
  const secret = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const key = `${KEY_PREFIX}${keyId}_${secret}`;
  return { key, keyId, hash: await sha256Hex(secret) };
}

/** Split a presented key into { keyId, secret }, or null when it is not shaped like one of ours. */
export function parseSavedKey(value) {
  if (typeof value !== 'string') return null;
  const match = KEY_PATTERN.exec(value.trim());
  return match ? { keyId: match[1], secret: match[2] } : null;
}

export function bearerToken(headerValue) {
  const header = String(headerValue || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

/** True when `secret` hashes to `storedHash`. */
export async function savedKeyMatches(secret, storedHash) {
  return constantTimeEqual(await sha256Hex(secret), String(storedHash || ''));
}
