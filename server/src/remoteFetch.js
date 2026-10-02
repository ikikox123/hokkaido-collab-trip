/** Identifies this tourist itinerary app on upstream requests. Not a secret. */
export const APP_USER_AGENT =
  'hokkaido-collab-trip/1.0 (tourist itinerary; +https://github.com/ikikox123/hokkaido-collab-trip)';

export async function fetchRemote(url, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    'User-Agent': APP_USER_AGENT,
    Accept: 'application/xml, application/json, text/xml, text/plain, */*',
    ...(options.etag ? { 'If-None-Match': options.etag } : {}),
    ...(options.headers || {}),
  };
  try {
    return await fetchImpl(url, { signal: controller.signal, headers });
  } finally {
    clearTimeout(timer);
  }
}

export function headerValue(res, name) {
  const headers = res?.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
  return key ? headers[key] : null;
}

export function assertFinalHost(res, hostname) {
  if (!res?.url) return;
  let host = '';
  try {
    host = new URL(res.url).hostname;
  } catch {
    throw new Error('unexpected redirect');
  }
  if (host !== hostname) throw new Error(`unexpected host ${host}`);
}
