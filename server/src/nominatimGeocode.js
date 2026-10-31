/**
 * Free OpenStreetMap Nominatim lookup for saved places (name + area -> lat/lng/address + precision).
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
export const MAX_REQUESTS_PER_PLACE = 3;

const join = (...parts) => parts.map((v) => cleanLine(v, 80)).filter(Boolean).join(' ');
const isJapan = (country) => /日本|japan|^jp$/i.test(String(country ?? '').trim());

export function geocodeQuery({ name, district, city, country }) {
  return join(name, district, city, country);
}

/**
 * Lookups to try in order; the first hit wins. 'place' steps look for the shop itself,
 * 'area' steps only find the middle of its district / city. Duplicate steps are dropped.
 */
export function geocodeSteps({ name, district, city, country }) {
  const cc = isJapan(country) ? 'jp' : '';
  const steps = [
    { query: join(name, district, city, country), cc: '', precision: 'place' },
    { query: join(name, city), cc: '', precision: 'place' },
    { query: join(name), cc, precision: 'place' },
    { query: join(district, city), cc, precision: 'area' },
    { query: join(city), cc, precision: 'area' },
  ];
  const seen = new Set();
  return steps.filter((step) => {
    if (!step.query || (!name && step.precision === 'place')) return false;
    const key = `${step.cc}|${step.query.normalize('NFKC').toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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

  async function request(query, cc) {
    const url = new URL(NOMINATIM_SEARCH);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '1');
    if (cc) url.searchParams.set('countrycodes', cc);
    const res = await (fetchImpl ?? globalThis.fetch)(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': APP_USER_AGENT, Accept: 'application/json', 'Accept-Language': 'ja,en' },
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return res.json();
  }

  /** One throttled request (shared 1/s queue). Resolves { value } or throws on timeout / HTTP error. */
  function throttled(query, cc) {
    const run = queue.then(async () => {
      const gap = lastStart + MIN_INTERVAL_MS - now();
      if (gap > 0) await wait(gap);
      lastStart = now();
      const first = (await request(query, cc))?.[0];
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { lat, lng, address: cleanLine(first.display_name, 200) }
        : null;
    });
    queue = run.catch(() => {});
    return run;
  }

  /** Resolves { lat, lng, address, precision: 'place' | 'area' } or null. Never throws. */
  return async function geocode(fields) {
    const steps = geocodeSteps(fields ?? {});
    if (!steps.length) return null;
    if (pending >= MAX_PENDING) return null;
    pending += 1;
    try {
      let requests = 0;
      for (const step of steps) {
        const key = `${step.cc}|${step.query.normalize('NFKC').toLowerCase()}`;
        const cached = cache.get(key);
        let value;
        if (cached && cached.expires > now()) {
          value = cached.value;
        } else {
          if (requests >= MAX_REQUESTS_PER_PLACE) return null;
          requests += 1;
          try {
            value = await throttled(step.query, step.cc);
          } catch {
            return null; // timeout / rate limit: not cached, try again next time
          }
          remember(key, value);
        }
        if (value) return { ...value, precision: step.precision };
      }
      return null;
    } finally {
      pending -= 1;
    }
  };
}
