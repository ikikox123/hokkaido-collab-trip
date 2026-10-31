import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaceGeocoder, POI_MAX_METERS } from './nominatimGeocode.js';

const sleep = async () => {};
const ADDRESS = '札幌市中央区北1条西3丁目';
const SHOP = { name: '味の時計台', city: '札幌市', district: '中央区', country: '日本', streetAddress: ADDRESS };

/** Address query answers with a block centre; the shop query with `poiResults`. */
function nominatim(poiResults) {
  const searches = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/reverse') return Response.json({ address: { city_district: '中央区' } });
    const q = u.searchParams.get('q');
    searches.push({ q, limit: u.searchParams.get('limit') });
    if (q === ADDRESS) return Response.json([{ lat: '43.0600', lon: '141.3500', display_name: '北1条西3丁目', category: 'place', type: 'house' }]);
    return Response.json(poiResults);
  };
  return { searches, fetchImpl };
}
const make = (n) => createPlaceGeocoder({ fetchImpl: n.fetchImpl, now: () => 0, sleep });

test('POI near the address result replaces the block centre (precision poi)', async () => {
  const n = nominatim([{ lat: '43.0605', lon: '141.3504', display_name: '味の時計台', category: 'amenity', type: 'restaurant' }]);
  const out = await make(n)(SHOP);
  assert.equal(out.precision, 'poi');
  assert.equal(out.lat, 43.0605);
  assert.equal(out.matched, 'address');
  assert.deepEqual(n.searches.map((s) => s.q), [ADDRESS, '味の時計台 札幌市']);
  assert.ok(n.searches.length <= 3);
});

test('POI farther than the limit is ignored; the address position stays', async () => {
  assert.equal(POI_MAX_METERS, 300);
  const n = nominatim([{ lat: '43.0700', lon: '141.3500', display_name: '同名の別店', category: 'shop', type: 'ramen' }]); // ~1.1 km
  const out = await make(n)(SHOP);
  assert.equal(out.precision, 'address');
  assert.equal(out.lat, 43.06);
});

test('no POI found (only non-shop results): the address position is used', async () => {
  const n = nominatim([{ lat: '43.0601', lon: '141.3501', display_name: '北1条通', category: 'highway', type: 'road' }]);
  const out = await make(n)(SHOP);
  assert.equal(out.precision, 'address');
  assert.equal(out.lat, 43.06);
  const empty = await make(nominatim([]))(SHOP);
  assert.equal(empty.precision, 'address');
});

test('a name search that already lands on a POI is precision poi without extra lookups', async () => {
  const n = nominatim([{ lat: '43.1', lon: '141.2', display_name: 'x', category: 'amenity', type: 'cafe' }]);
  const out = await make(n)({ name: '空', city: '札幌市', district: '中央区', country: '日本' });
  assert.equal(out.precision, 'poi');
  assert.equal(n.searches.length, 1);
});
