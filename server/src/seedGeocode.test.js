import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState, SEED_COORDINATES } from './seed.js';
import { haversineMeters } from './legs.js';
import { SEED_LOOKUPS, acceptFix, applySeedFixes, formatCoordinateBlock } from './seedGeocode.js';

test('every seed stop and the lodging point has a lookup and a Hokkaido coordinate', () => {
  const state = createSeedState();
  const ids = new Set(SEED_LOOKUPS.map((row) => row.id));
  for (const stop of state.stops) {
    assert.ok(ids.has(stop.id), `missing lookup ${stop.id}`);
    assert.ok(SEED_COORDINATES[stop.id]);
    assert.ok(haversineMeters(stop, { lat: 43.2, lng: 142 }) < 250000);
  }
  assert.ok(ids.has('lodging'));
  assert.ok(Math.abs(state.lodging.lat - SEED_COORDINATES.lodging.lat) < 1e-6);
});

test('famous spots use published coordinates, not the old rough pins', () => {
  const state = createSeedState();
  const byId = Object.fromEntries(state.stops.map((s) => [s.id, s]));
  const near = (id, lat, lng, meters = 80) => {
    const d = haversineMeters(byId[id], { lat, lng });
    assert.ok(d <= meters, `${id} is ${Math.round(d)}m from ${lat},${lng}`);
  };
  near('s7', 43.0625, 141.353611);
  near('s8', 43.061092, 141.356433);
  near('s10', 43.054333, 141.3075);
  near('s15', 43.768028, 142.479778);
  near('s17', 43.418894, 142.426581);
  near('s19', 43.493583, 142.614028);
  near('s20', 43.143611, 141.036667);
  near('s24', 43.190579, 141.007837);
  assert.ok(byId.s1.lat > 42.78, 'CTS marker should be the terminal, not the runway reference point');
  assert.ok(byId.s20.lng < 141.1, 'Asarigawa should sit west toward Otaru');
  assert.ok(byId.s17.lat < 43.45, 'Farm Tomita is in Nakafurano, south of Biei hills');
});

test('applySeedFixes moves a matching seed title and leaves renamed stops', () => {
  const state = createSeedState();
  state.stops = state.stops.map((s) => (s.id === 's7' ? { ...s, title: '自訂名稱' } : s));
  const applied = applySeedFixes(state, {
    s7: { lat: 43.07, lng: 141.36 },
    s16: { lat: 43.53, lng: 142.47 },
    lodging: { lat: 43.058, lng: 141.337 },
  });
  const clock = applied.state.stops.find((s) => s.id === 's7');
  assert.equal(clock.lat, state.stops.find((s) => s.id === 's7').lat);
  const hill = applied.state.stops.find((s) => s.id === 's16');
  assert.equal(hill.lat, 43.53);
  assert.ok(applied.movedIds.includes('s16'));
  assert.equal(applied.movedIds.includes('s7'), false);
  state.lodging = { ...state.lodging, name: '別的住宿', lat: 43.2, lng: 141.3 };
  const renamed = applySeedFixes(state, { lodging: { lat: 43.06, lng: 141.35 } });
  assert.equal(renamed.state.lodging.name, '別的住宿');
  assert.equal(renamed.state.lodging.lat, 43.2);
});

test('acceptFix rejects a result far from the city bias', () => {
  assert.equal(acceptFix({ lat: 43.0625, lng: 141.3536 }, 'circle:2000@43.062,141.354'), true);
  assert.equal(acceptFix({ lat: 35.68, lng: 139.76 }, 'circle:2000@43.062,141.354'), false);
  assert.equal(acceptFix({ lat: 43.7, lng: 142.5 }, 'circle:2000@43.062,141.354'), false);
});

test('coordinate block writer only emits numbers', () => {
  const block = formatCoordinateBlock({ s1: { lat: 42.787808, lng: 141.680869 } });
  assert.match(block, /SEED_COORDINATES_START/);
  assert.equal(block.includes('key'), false);
  assert.match(block, /s1: \{ lat: 42\.787808, lng: 141\.680869 \}/);
});
