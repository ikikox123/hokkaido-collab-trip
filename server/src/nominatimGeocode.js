/**
 * Free OpenStreetMap Nominatim lookup for saved places (name + area -> lat/lng/address + precision).
 * Custom User-Agent, one request per second, cached, short timeout. Any failure returns null
 * and the place simply has no coordinates. No Google API is called.
 *
 * Request budget per place: up to MAX_REQUESTS_PER_PLACE (3) search requests, plus at most
 * MAX_REVERSE_PER_PLACE (1) reverse request (a pasted street address is the first of those searches), made only when the result has precision 'place'
 * (so 4 Nominatim requests at most). The reverse request does not use up the search budget.
 * A street-address hit is usually the middle of a block: right after it, one POI search (shop name + city, counted in the
 * 3 searches) looks for the shop itself. A POI (amenity / shop / tourism ...) within POI_MAX_METERS of the address replaces
 * the address position (precision 'poi'); otherwise the address position stays (precision 'address').
 * Reverse looks up the OSM administrative district (the AI's district is not trusted); it shares
 * the 1 req/s queue, User-Agent, timeout and cache (key: coordinates rounded to 4 decimals).
 */
import { APP_USER_AGENT } from './remoteFetch.js';
import { cleanLine, cleanDistrict } from './savedPlace.js';

const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const TIMEOUT_MS = 4000;
export const MIN_INTERVAL_MS = 1100;
const HIT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MISS_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 500;
const MAX_PENDING = 6;
export const MAX_REQUESTS_PER_PLACE = 3;
export const MAX_REVERSE_PER_PLACE = 1;
export const POI_MAX_METERS = 300;
const POI_CLASSES = new Set(['amenity', 'shop', 'tourism', 'leisure', 'craft', 'office']);
const POI_CANDIDATES = 5;

/** Nominatim result of a shop-like thing (jsonv2 `category`, older `class`). */
export function isPoiResult(item) {
  return POI_CLASSES.has(String(item?.category ?? item?.class ?? ''));
}

function metersBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * Administrative district (区 / 町 / 村) from a Nominatim reverse `address` object, in the local language; '' when absent.
 * Neighbourhoods such as 色内 or street-like names are skipped: a city without wards (小樽市) has no district.
 */
export function districtFromAddress(address) {
  for (const key of ['city_district', 'suburb', 'quarter', 'neighbourhood']) {
    const name = cleanDistrict(address?.[key], address?.city);
    if (name) return name;
  }
  return '';
}

const join = (...parts) => parts.map((v) => cleanLine(v, 80)).filter(Boolean).join(' ');
const isJapan = (country) => /日本|japan|^jp$/i.test(String(country ?? '').trim());

export function geocodeQuery({ name, district, city, country }) {
  return join(name, district, city, country);
}

/**
 * Lookups to try in order; the first hit wins. 'place' steps look for the shop itself,
 * 'area' steps only find the middle of its district / city. Duplicate steps are dropped.
 */
export function geocodeSteps({ name, district, city, country, streetAddress }) {
  const cc = isJapan(country) ? 'jp' : '';
  const steps = [
    // A full street address the poster wrote is searched first; a hit is the exact spot.
    streetAddress ? { query: join(streetAddress), cc: 'jp', precision: 'place', via: 'address' } : null,
    { query: join(name, district, city, country), cc: '', precision: 'place' },
    { query: join(name, city), cc: '', precision: 'place' },
    // With district and city known, the name alone could match a same-named shop elsewhere: use the district centre instead.
    district && city
      ? { query: join(district, city), cc, precision: 'area' }
      : { query: join(name), cc, precision: 'place' },
    { query: join(district, city), cc, precision: 'area' },
    { query: join(city), cc, precision: 'area' },
  ];
  const seen = new Set();
  return steps.filter((step) => {
    if (!step || !step.query || (!name && step.precision === 'place' && !step.via)) return false;
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

  async function request(url) {
    const res = await (fetchImpl ?? globalThis.fetch)(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': APP_USER_AGENT, Accept: 'application/json', 'Accept-Language': 'ja' },
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    return res.json();
  }

  /** Run `task` through the shared 1/s queue. Rejects on timeout / HTTP error. */
  function throttled(task) {
    const run = queue.then(async () => {
      const gap = lastStart + MIN_INTERVAL_MS - now();
      if (gap > 0) await wait(gap);
      lastStart = now();
      return task();
    });
    queue = run.catch(() => {});
    return run;
  }

  function search(query, cc, poiOnly = false) {
    return throttled(async () => {
      const url = new URL(NOMINATIM_SEARCH);
      url.searchParams.set('q', query);
      url.searchParams.set('format', 'jsonv2');
      url.searchParams.set('limit', poiOnly ? String(POI_CANDIDATES) : '1');
      if (cc) url.searchParams.set('countrycodes', cc);
      const list = (await request(url)) ?? [];
      const first = poiOnly ? list.find(isPoiResult) : list[0];
      const lat = Number(first?.lat);
      const lng = Number(first?.lon);
      return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
        ? { lat, lng, address: cleanLine(first.display_name, 200), poi: isPoiResult(first) }
        : null;
    });
  }

  /** District name of a position (one reverse request, cached by 4-decimal coordinates). null on failure / no field. */
  async function reverseDistrict(lat, lng) {
    const key = `rev|${lat.toFixed(4)},${lng.toFixed(4)}`;
    const cached = cache.get(key);
    if (cached && cached.expires > now()) return cached.value;
    try {
      const district = await throttled(async () => {
        const url = new URL(NOMINATIM_REVERSE);
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('lat', String(lat));
        url.searchParams.set('lon', String(lng));
        url.searchParams.set('zoom', '18');
        url.searchParams.set('addressdetails', '1');
        return districtFromAddress((await request(url))?.address) || null;
      });
      remember(key, district);
      return district;
    } catch {
      return null; // not cached
    }
  }

  /** POI near `origin` (shop name + city / district), or null. `spend()` is truthy while the search budget allows another request. */
  async function findShop(steps, fields, origin, spend) {
    const query = join(fields.name, fields.city || fields.district);
    if (!fields.name || !query) return null;
    const cc = isJapan(fields.country) || steps[0]?.cc === 'jp' ? 'jp' : '';
    const key = `poi|${cc}|${query.normalize('NFKC').toLowerCase()}`;
    const cached = cache.get(key);
    let hit;
    if (cached && cached.expires > now()) {
      hit = cached.value;
    } else {
      if (!spend()) return null;
      try {
        hit = await search(query, cc, true);
      } catch {
        return null;
      }
      remember(key, hit);
    }
    return hit && metersBetween(origin, hit) < POI_MAX_METERS ? { lat: hit.lat, lng: hit.lng, address: hit.address || origin.address } : null;
  }

  /** Resolves { lat, lng, address, precision: 'poi' | 'address' | 'place' | 'area', district? (OSM, place only), matched? ('address' when the pasted street address was found) } or null. Never throws. */
  return async function geocode(fields) {
    fields = fields ?? {};
    const steps = geocodeSteps(fields);
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
            value = await search(step.query, step.cc);
          } catch {
            return null; // timeout / rate limit: not cached, try again next time
          }
          remember(key, value);
        }
        if (value) {
          const { poi, ...position } = value;
          let found = position;
          let precision = step.precision === 'place' && poi ? 'poi' : step.precision;
          if (step.via === 'address' && precision !== 'poi') {
            // The address is a block centre at best: look for the shop itself, within the same request budget.
            precision = 'address';
            const shop = await findShop(steps, fields, position, () => requests < MAX_REQUESTS_PER_PLACE && ++requests);
            if (shop) {
              found = shop;
              precision = 'poi';
            }
          }
          const out = { ...found, precision, ...(step.via ? { matched: step.via } : {}) };
          if (step.precision === 'place') {
            const district = await reverseDistrict(value.lat, value.lng); // budget: MAX_REVERSE_PER_PLACE, separate from searches
            if (district) out.district = district;
          }
          return out;
        }
      }
      return null;
    } finally {
      pending -= 1;
    }
  };
}
