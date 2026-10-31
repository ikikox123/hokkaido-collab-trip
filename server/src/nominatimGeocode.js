/**
 * Free OpenStreetMap Nominatim lookup for saved places (name + area -> lat/lng/address).
 * Custom User-Agent, one request per second, cached, short timeout. Any failure returns null
 * and the place simply has no coordinates. No Google API is called.
 */
import { APP_USER_AGENT } from './remoteFetch.js';
import { cleanLine } from './savedPlace.js';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 4000;
export const MIN_INTERVAL_MS = 1100;
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_PENDING = 6;

export function geocodeQuery({ name, district, city, country }) {
  return [name, district, city, country].map((v) => cleanLine(v, 80)).filter(Boolean).join(' ');
}

export function createPlaceGeocoder({ fetchImpl, now = () => Date.now(), sleep } = {}) {
  const cache = new Map();
  let lastStart = 0;
  let queue = Promise.resolve();
  let pending = 0;
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  function remember(key, value) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { value, expires: now() + (value ? HIT_TTL_MS : MISS_TTL_MS) });
  }

  async function request(query) {
    const url = new URL(NOMINATIM_SEARCH);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    const res = await (fetchImpl ?? globalThis.fetch)(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': APP_USER_AGENT, Accept: 'application/json', 'Accept-Language': 'ja,en' },
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return res.json();
  }

  /** Resolves { lat, lng, address } or null. Never throws. */
  return async function geocode(fields) {
    const query = geocodeQuery(fields);
    if (!query) return null;
    const key = query.normalize('NFKC').toLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    if (pending >= MAX_PENDING) return null;
    pending += 1;
    const run = queue.then(async () => {
      const gap = lastStart + MIN_INTERVAL_MS - now();
      if (gap > 0) await wait(gap);
      lastStart = now();
      try {
        const first = (await request(query))?.[0];
        const lat = Number(first?.lat);
        const lng = Number(first?.lon);
        const value =
          Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
            ? { lat, lng, address: cleanLine(first.display_name, 200) }
            : null;
        remember(key, value);
        return value;
      } catch {
        return null; // timeout / rate limit: not cached, try again next time
      } finally {
        pending -= 1;
      }
    });
    queue = run.catch(() => {});
    return run;
  };
}
