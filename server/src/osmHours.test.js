import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createOsmHoursLookup,
  distanceMeters,
  namesMatch,
  normalizePlaceName,
  parseOpeningHoursQuery,
  pickOsmHours,
} from './osmHours.js';

const CLOCK_TOWER = { lat: 43.0625, lng: 141.353611 };

function item(overrides = {}) {
  return {
    lat: String(CLOCK_TOWER.lat),
    lon: String(CLOCK_TOWER.lng),
    namedetails: { name: '札幌時計台', 'name:en': 'Sapporo Clock Tower' },
    extratags: { opening_hours: 'Tu-Su 08:45-17:10' },
    ...overrides,
  };
}

test('name matching: normalized equal or containing, never loose', () => {
  assert.equal(normalizePlaceName('Ｓapporo  Clock-Tower'), 'sapporoclocktower');
  assert.equal(namesMatch('札幌時計台', '札幌 時計台'), true);
  assert.equal(namesMatch('札幌市時計台', '時計台'), true);
  assert.equal(namesMatch('Sapporo Clock Tower', 'sapporo clock tower'), true);
  assert.equal(namesMatch('札幌市時計台', '札幌電視塔'), false);
  assert.equal(namesMatch('店', '蟹の店'), false, 'one-character names must match exactly');
  assert.equal(namesMatch('', '札幌'), false);
});

test('distance is in meters', () => {
  const d = distanceMeters(43.0, 141.0, 43.001, 141.0);
  assert.ok(d > 110 && d < 112, String(d));
});

test('pickOsmHours takes a matching object within 150 m, including name:en', () => {
  assert.equal(pickOsmHours([item()], { name: '札幌時計台', ...CLOCK_TOWER }), 'Tu-Su 08:45-17:10');
  assert.equal(pickOsmHours([item()], { name: 'Sapporo Clock Tower', ...CLOCK_TOWER }), 'Tu-Su 08:45-17:10');
});

test('pickOsmHours refuses a different name, a far object, or missing hours', () => {
  assert.equal(pickOsmHours([item()], { name: '札幌電視塔', ...CLOCK_TOWER }), null);
  const far = item({ lat: String(CLOCK_TOWER.lat + 0.0021) }); // ~233 m
  assert.equal(pickOsmHours([far], { name: '札幌時計台', ...CLOCK_TOWER }), null);
  assert.equal(pickOsmHours([item({ extratags: {} })], { name: '札幌時計台', ...CLOCK_TOWER }), null);
  assert.equal(pickOsmHours([item({ extratags: undefined })], { name: '札幌時計台', ...CLOCK_TOWER }), null);
  assert.equal(pickOsmHours(undefined, { name: 'x', ...CLOCK_TOWER }), null);
});

test('pickOsmHours prefers the nearest match and does not fall back to a farther one', () => {
  const near = item({ lat: String(CLOCK_TOWER.lat + 0.0003), extratags: { opening_hours: 'near' } });
  const nearer = item({ extratags: { opening_hours: 'nearest' } });
  assert.equal(pickOsmHours([near, nearer], { name: '札幌時計台', ...CLOCK_TOWER }), 'nearest');
  const noHours = item({ extratags: {} });
  const other = item({ lat: String(CLOCK_TOWER.lat + 0.0003), extratags: { opening_hours: 'farther' } });
  assert.equal(pickOsmHours([noHours, other], { name: '札幌時計台', ...CLOCK_TOWER }), null);
});

test('pickOsmHours leaves the field empty when the OSM string would not fit', () => {
  const long = item({ extratags: { opening_hours: 'Mo-Fr 09:00-18:00; '.repeat(6) } });
  assert.equal(pickOsmHours([long], { name: '札幌時計台', ...CLOCK_TOWER }), null);
});

function lookupWith(responder, extra = {}) {
  const calls = [];
  const clock = { t: 1_000_000 };
  const lookup = createOsmHoursLookup({
    fetchImpl: async (url, init) => {
      calls.push({ url: new URL(url), init });
      return responder(calls.length);
    },
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    ...extra,
  });
  return { lookup, calls, clock };
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

test('lookup calls Nominatim with extratags, a bounded viewbox and our User-Agent', async () => {
  const { lookup, calls } = lookupWith(() => ok([item()]));
  assert.equal(await lookup({ name: '札幌時計台', ...CLOCK_TOWER }), 'Tu-Su 08:45-17:10');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.hostname, 'nominatim.openstreetmap.org');
  assert.equal(calls[0].url.searchParams.get('extratags'), '1');
  assert.equal(calls[0].url.searchParams.get('bounded'), '1');
  assert.match(calls[0].init.headers['User-Agent'], /hokkaido-collab-trip/);
});

test('lookup caches hits and misses, and spaces real requests at least a second apart', async () => {
  const { lookup, calls, clock } = lookupWith((n) => ok(n === 1 ? [item()] : []));
  const args = { name: '札幌時計台', ...CLOCK_TOWER };
  assert.equal(await lookup(args), 'Tu-Su 08:45-17:10');
  assert.equal(await lookup(args), 'Tu-Su 08:45-17:10');
  assert.equal(calls.length, 1, 'second call is served from cache');
  const t0 = clock.t;
  assert.equal(await lookup({ name: 'Nowhere Cafe', ...CLOCK_TOWER }), null);
  assert.ok(clock.t - t0 >= 1000, 'waited for the 1 request/second window');
  assert.equal(await lookup({ name: 'Nowhere Cafe', ...CLOCK_TOWER }), null);
  assert.equal(calls.length, 2, 'misses are cached too');
});

test('lookup returns null on HTTP errors, bad JSON, and network failure, and does not cache them', async () => {
  let mode = 'http';
  const { lookup, calls } = lookupWith(() => {
    if (mode === 'http') return { ok: false, status: 429, json: async () => ({}) };
    if (mode === 'json') return { ok: true, status: 200, json: async () => { throw new Error('bad'); } };
    if (mode === 'net') throw new Error('offline');
    return ok([item()]);
  });
  const args = { name: '札幌時計台', ...CLOCK_TOWER };
  for (const m of ['http', 'json', 'net']) {
    mode = m;
    assert.equal(await lookup(args), null, m);
  }
  mode = 'fine';
  assert.equal(await lookup(args), 'Tu-Su 08:45-17:10');
  assert.equal(calls.length, 4);
});

test('lookup does not call out for blank names or bad coordinates', async () => {
  const { lookup, calls } = lookupWith(() => ok([]));
  assert.equal(await lookup({ name: ' ', ...CLOCK_TOWER }), null);
  assert.equal(await lookup({ name: 'x', lat: NaN, lng: 1 }), null);
  assert.equal(calls.length, 0);
});

test('parseOpeningHoursQuery validates the query string', () => {
  const q = (s) => parseOpeningHoursQuery(new URLSearchParams(s));
  assert.deepEqual(q('name=%E6%99%82%E8%A8%88%E5%8F%B0&lat=43.06&lng=141.35'), { name: '時計台', lat: 43.06, lng: 141.35 });
  assert.equal(q('lat=43&lng=141').status, 400);
  assert.equal(q('name=x&lat=abc&lng=141').status, 400);
  assert.equal(q('name=x&lat=99&lng=141').status, 400);
  assert.equal(q(`name=${'x'.repeat(161)}&lat=43&lng=141`).status, 400);
});
