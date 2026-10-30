/**
 * Free opening hours from OpenStreetMap (Nominatim `extratags`), used when a stop is added.
 * Google's opening-hours fields are Enterprise-tier and are deliberately never requested.
 *
 * Nothing is guessed: a result is used only when the OSM object's name matches the picked place
 * (normalized equal, or one contains the other) and it lies within MATCH_RADIUS_M of the point.
 * Any failure or doubt returns null and the field stays empty.
 */
import { APP_USER_AGENT } from './remoteFetch.js';
import { cleanStopHours } from './stopInfo.js';

export const MATCH_RADIUS_M = 150;
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const TIMEOUT_MS = 4000;
const MIN_INTERVAL_MS = 1100; // Nominatim policy: at most 1 request per second.
const HIT_TTL_MS = 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_PENDING = 6;
const MIN_NAME_LENGTH = 2;
const NAME_KEYS = ['name', 'name:ja', 'name:en', 'official_name', 'alt_name', 'short_name'];

/** NFKC, lower-case, only letters and digits (any script). 「Fa-so-la　Odori」→ "fasolaodori". */
export function normalizePlaceName(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Equal after normalizing, or one contains the other. Very short names must match exactly. */
export function namesMatch(a, b) {
  const x = normalizePlaceName(a);
  const y = normalizePlaceName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return Array.from(short).length >= MIN_NAME_LENGTH && long.includes(short);
}

export function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function osmNames(item) {
  const tagged = { ...(item?.namedetails || {}) };
  return NAME_KEYS.map((key) => tagged[key]).filter((v) => typeof v === 'string' && v);
}

/**
 * Choose the nearest Nominatim result that matches `name` within the radius.
 * Returns the cleaned hours string, or null. A matching object without hours yields null too.
 */
export function pickOsmHours(results, { name, lat, lng }) {
  if (!Array.isArray(results)) return null;
  let best = null;
  for (const item of results) {
    const iLat = Number(item?.lat);
    const iLng = Number(item?.lon);
    if (!Number.isFinite(iLat) || !Number.isFinite(iLng)) continue;
    const meters = distanceMeters(lat, lng, iLat, iLng);
    if (meters > MATCH_RADIUS_M) continue;
    if (!osmNames(item).some((osmName) => namesMatch(osmName, name))) continue;
    if (!best || meters < best.meters) best = { item, meters };
  }
  const raw = best?.item?.extratags?.opening_hours;
  if (typeof raw !== 'string') return null;
  const cleaned = cleanStopHours(raw);
  // Too long for the field: leave it empty rather than cut a schedule in half.
  return cleaned.ok && cleaned.value ? cleaned.value : null;
}

function searchUrl({ name, lat, lng }) {
  const dLat = 0.004; // ~440 m, a little wider than the match radius.
  const dLng = dLat / Math.max(0.2, Math.cos((lat * Math.PI) / 180));
  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set('q', name);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('extratags', '1');
  url.searchParams.set('namedetails', '1');
  url.searchParams.set('limit', '10');
  url.searchParams.set('viewbox', `${lng - dLng},${lat + dLat},${lng + dLng},${lat - dLat}`);
  url.searchParams.set('bounded', '1');
  return url;
}

/** Cache + one-request-per-second gate. One instance per process / Durable Object. */
export function createOsmHoursLookup({ fetchImpl, now = () => Date.now(), sleep } = {}) {
  const cache = new Map();
  let lastStart = 0;
  let queue = Promise.resolve();
  let pending = 0;
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  function remember(key, hours) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(key, { hours, expires: now() + (hours ? HIT_TTL_MS : MISS_TTL_MS) });
  }

  async function request(url) {
    const doFetch = fetchImpl ?? globalThis.fetch;
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': APP_USER_AGENT, Accept: 'application/json', 'Accept-Language': 'ja,en' },
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return res.json();
  }

  /** Resolves to a hours string or null. Never throws. */
  return async function lookup({ name, lat, lng }) {
    const clean = String(name ?? '').trim().slice(0, 160);
    if (!normalizePlaceName(clean) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const key = `${normalizePlaceName(clean)}@${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.hours;

    if (pending >= MAX_PENDING) return null;
    pending += 1;
    const run = queue.then(async () => {
      const gap = lastStart + MIN_INTERVAL_MS - now();
      if (gap > 0) await wait(gap);
      lastStart = now();
      try {
        const hours = pickOsmHours(await request(searchUrl({ name: clean, lat, lng })), { name: clean, lat, lng });
        remember(key, hours);
        return hours;
      } catch {
        // Timeout, network, or rate-limit: leave it empty and try again later, not cached.
        return null;
      } finally {
        pending -= 1;
      }
    });
    queue = run.catch(() => {});
    return run;
  };
}

/** Validate GET /api/opening-hours?name=&lat=&lng=. Returns { name, lat, lng } or { status, error }. */
export function parseOpeningHoursQuery(params) {
  const name = String(params.get('name') || '').trim();
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (!name) return { status: 400, error: '請輸入地點' };
  if (name.length > 160) return { status: 400, error: '查詢過長' };
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { status: 400, error: '座標超出範圍' };
  }
  return { name, lat, lng };
}
