/**
 * SSRF-safe page fetch for saved places. Pure logic over an injectable fetch, so node tests and the Worker share it.
 *
 * Only a short allow-list of https hosts on the default port is ever requested. Redirects are followed
 * by hand (at most MAX_REDIRECTS) and every hop is checked again. Time, size, and content type are capped.
 * IP literals, localhost and reserved names are refused before the allow-list too, as a second layer.
 */
import { APP_USER_AGENT } from './remoteFetch.js';

export const ALLOWED_HOSTS = new Set([
  'threads.net',
  'www.threads.net',
  'threads.com',
  'www.threads.com',
  'instagram.com',
  'www.instagram.com',
]);
export const MAX_REDIRECTS = 3;
export const FETCH_TIMEOUT_MS = 5000;
export const MAX_RESPONSE_BYTES = 1024 * 1024;

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const RESERVED_SUFFIXES = ['.localhost', '.local', '.internal', '.localdomain', '.lan', '.home.arpa'];

/** True for IP literals in any spelling (dotted, decimal, octal, hex, IPv6), localhost, and reserved suffixes. */
export function isBlockedHostname(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host.includes(':')) return true; // IPv6 literal, including ::ffff:127.0.0.1
  if (host === 'localhost' || RESERVED_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  const labels = host.split('.');
  // 127.0.0.1, 2130706433, 0x7f.1, 0177.0.0.1: every label is a plain number.
  if (labels.every((label) => /^(0x[0-9a-f]*|\d+)$/i.test(label))) return true;
  return false;
}

/** Validate one URL. Returns { ok: true, url } or { ok: false, reason }. */
export function checkFetchUrl(input) {
  let url;
  try {
    url = new URL(String(input));
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'scheme' };
  if (url.username || url.password) return { ok: false, reason: 'credentials' };
  if (url.port) return { ok: false, reason: 'port' };
  if (isBlockedHostname(url.hostname)) return { ok: false, reason: 'blocked_host' };
  if (!ALLOWED_HOSTS.has(url.hostname)) return { ok: false, reason: 'host_not_allowed' };
  return { ok: true, url };
}

/** Read at most maxBytes of a response body. Returns { text, truncated }. */
export async function readCapped(res, maxBytes = MAX_RESPONSE_BYTES) {
  if (!res.body || typeof res.body.getReader !== 'function') {
    const text = await res.text();
    const bytes = new TextEncoder().encode(text);
    return bytes.length > maxBytes
      ? { text: new TextDecoder().decode(bytes.slice(0, maxBytes)), truncated: true }
      : { text, truncated: false };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > maxBytes) {
      chunks.push(value.slice(0, maxBytes - total));
      total = maxBytes;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.length;
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return { text: new TextDecoder('utf-8').decode(bytes), truncated };
}

async function discard(res) {
  try {
    await res.body?.cancel();
  } catch {
    /* already closed */
  }
}

/**
 * Fetch an HTML page. Never throws.
 * Resolves { ok: true, html, finalUrl, truncated } or { ok: false, reason }.
 */
export async function fetchPage(input, { fetchImpl, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const signal = AbortSignal.timeout(timeoutMs); // one deadline for the whole chain
  let current = String(input);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const checked = checkFetchUrl(current);
      if (!checked.ok) return { ok: false, reason: hop === 0 ? checked.reason : `redirect_${checked.reason}` };
      const res = await doFetch(checked.url.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { 'User-Agent': APP_USER_AGENT, Accept: 'text/html', 'Accept-Language': 'ja,zh-TW,en' },
      });
      if (REDIRECT_STATUS.has(res.status)) {
        const location = res.headers.get('location');
        await discard(res);
        if (!location) return { ok: false, reason: 'bad_redirect' };
        if (hop === MAX_REDIRECTS) return { ok: false, reason: 'too_many_redirects' };
        try {
          current = new URL(location, checked.url).href;
        } catch {
          return { ok: false, reason: 'bad_redirect' };
        }
        continue;
      }
      if (!res.ok) {
        await discard(res);
        return { ok: false, reason: 'http_status' };
      }
      const type = String(res.headers.get('content-type') || '').toLowerCase();
      if (!type.startsWith('text/html')) {
        await discard(res);
        return { ok: false, reason: 'not_html' };
      }
      const { text, truncated } = await readCapped(res, maxBytes);
      return { ok: true, html: text, finalUrl: checked.url.href, truncated };
    }
    return { ok: false, reason: 'too_many_redirects' };
  } catch (err) {
    return { ok: false, reason: err?.name === 'TimeoutError' || err?.name === 'AbortError' ? 'timeout' : 'network' };
  }
}
