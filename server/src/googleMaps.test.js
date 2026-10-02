import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePolyline,
  directionsProfile,
  inHokkaido,
  redactSecrets,
} from './googleMaps.js';

test('directions profile maps trip modes onto Google travel modes', () => {
  assert.deepEqual(directionsProfile('walk'), { travelMode: 'walking', transitMode: null });
  for (const mode of ['taxi', 'car', 'charter']) {
    assert.equal(directionsProfile(mode).travelMode, 'driving');
  }
  assert.equal(directionsProfile('subway').travelMode, 'transit');
  assert.equal(directionsProfile('subway').transitMode, 'subway');
  assert.equal(directionsProfile('jr').transitMode, 'rail');
  assert.equal(directionsProfile('bus').transitMode, 'bus');
});

test('decodes the Google polyline sample', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(pts.length, 3);
  assert.ok(Math.abs(pts[0][0] - 38.5) < 1e-4);
  assert.ok(Math.abs(pts[0][1] - -120.2) < 1e-4);
  assert.ok(Math.abs(pts[1][0] - 40.7) < 1e-4);
  assert.ok(Math.abs(pts[1][1] - -120.95) < 1e-4);
  assert.ok(Math.abs(pts[2][0] - 43.252) < 1e-4);
  assert.ok(Math.abs(pts[2][1] - -126.453) < 1e-4);
});

test('redactSecrets strips the key and key= query values', () => {
  const key = 'test-key-value';
  const raw = `https://maps.googleapis.com/maps/api/directions/json?key=${key}&mode=walking`;
  const out = redactSecrets(`status ${key} ${raw}`, key);
  assert.equal(out.includes(key), false);
  assert.match(out, /key=\[redacted\]/);
});

test('Hokkaido bounds reject a Tokyo point', () => {
  assert.equal(inHokkaido(43.06, 141.35), true);
  assert.equal(inHokkaido(35.68, 139.76), false);
});
