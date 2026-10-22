/**
 * HS256 JSON Web Tokens with WebCrypto.
 * Same wire format as `jsonwebtoken` (iat/exp in seconds), so a token signed
 * by the Railway server with the same JWT_SECRET still verifies here.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const keyCache = new Map();

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function hmacKey(secret) {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
      'verify',
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

export async function signJwt(payload, secret, { expiresInSec = 7 * 24 * 60 * 60, now = Date.now() } = {}) {
  const iat = Math.floor(now / 1000);
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = base64UrlEncode(encoder.encode(JSON.stringify({ ...payload, iat, exp: iat + expiresInSec })));
  const data = `${header}.${body}`;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(data));
  return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Returns the payload, or null when the token is malformed, forged, or expired. */
export async function verifyJwt(token, secret, { now = Date.now() } = {}) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const header = JSON.parse(decoder.decode(base64UrlDecode(parts[0])));
    if (header?.alg !== 'HS256') return null;
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      base64UrlDecode(parts[2]),
      encoder.encode(`${parts[0]}.${parts[1]}`),
    );
    if (!valid) return null;
    const payload = JSON.parse(decoder.decode(base64UrlDecode(parts[1])));
    if (!payload || typeof payload !== 'object') return null;
    if (typeof payload.exp === 'number' && Math.floor(now / 1000) >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
