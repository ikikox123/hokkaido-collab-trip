import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from './seed.js';
import { applyLodgingPatch, LODGING_ADDRESS_MAX, LODGING_NAME_MAX } from './lodgingEdit.js';

function samplePatch(overrides = {}) {
  return {
    name: ' 41PIECES SAPPORO ',
    address: ' 札幌市中央區 ',
    lat: 43.055,
    lng: 141.353,
    ...overrides,
  };
}

test('applyLodgingPatch trims name and address and replaces only lodging', () => {
  const state = createSeedState();
  const beforeName = state.lodging.name;
  const result = applyLodgingPatch(state, {
    ...samplePatch(),
    stops: [],
    legs: [],
    members: [{ id: 'intruder' }],
    expenses: [{ id: 'e' }],
    settlements: [{ id: 's' }],
    roomCode: 'OTHER',
    flights: { outbound: 'nope', inbound: 'nope' },
  });
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, false);
  assert.equal(result.state.lodging.name, '41PIECES SAPPORO');
  assert.equal(result.state.lodging.address, '札幌市中央區');
  assert.equal(result.state.lodging.lat, 43.055);
  assert.equal(result.state.lodging.lng, 141.353);
  assert.deepEqual(Object.keys(result.state.lodging).sort(), ['address', 'lat', 'lng', 'name']);
  assert.equal(result.state.stops, state.stops);
  assert.equal(result.state.legs, state.legs);
  assert.equal(result.state.members, state.members);
  assert.equal(result.state.expenses, state.expenses);
  assert.equal(result.state.settlements, state.settlements);
  assert.equal(result.state.flights, state.flights);
  assert.equal(result.state.roomCode, state.roomCode);
  assert.equal(result.state.days, state.days);
  assert.equal(state.lodging.name, beforeName);
  assert.notEqual(result.state.lodging, state.lodging);
});

test('applyLodgingPatch accepts a trip that has no lodging yet', () => {
  const state = createSeedState();
  delete state.lodging;
  const result = applyLodgingPatch(state, {
    name: '新住宿',
    lat: 43.06,
    lng: 141.35,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.lodging, {
    name: '新住宿',
    address: '',
    lat: 43.06,
    lng: 141.35,
  });
  assert.equal(state.lodging, undefined);
  assert.equal(result.state.stops, state.stops);
});

test('applyLodgingPatch treats a blank address as optional and reports unchanged', () => {
  const state = createSeedState();
  state.lodging = { name: '已住過', address: '', lat: 43.1, lng: 141.4 };
  const result = applyLodgingPatch(state, {
    name: '  已住過  ',
    address: '   ',
    lat: 43.1,
    lng: 141.4,
    extra: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, true);
  assert.equal(result.state, state);
});

test('applyLodgingPatch rejects a blank or overlong name without mutating state', () => {
  const state = createSeedState();
  const lodging = state.lodging;
  for (const name of ['', '   ', '\n\t', '\u3000', null, 12, {}]) {
    const result = applyLodgingPatch(state, samplePatch({ name }));
    assert.equal(result.ok, false);
    assert.equal(result.error, '住宿名稱不可空白');
  }
  const tooLong = applyLodgingPatch(state, samplePatch({ name: '宿'.repeat(LODGING_NAME_MAX + 1) }));
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error, '住宿名稱過長');
  const exact = applyLodgingPatch(state, samplePatch({ name: `  ${'宿'.repeat(LODGING_NAME_MAX)}  ` }));
  assert.equal(exact.ok, true);
  assert.equal(exact.state.lodging.name.length, LODGING_NAME_MAX);
  assert.equal(state.lodging, lodging);
});

test('applyLodgingPatch rejects an overlong or non-string address', () => {
  const state = createSeedState();
  const tooLong = applyLodgingPatch(state, samplePatch({ address: '址'.repeat(LODGING_ADDRESS_MAX + 1) }));
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error, '住宿地址過長');
  const exact = applyLodgingPatch(state, samplePatch({ address: '址'.repeat(LODGING_ADDRESS_MAX) }));
  assert.equal(exact.ok, true);
  assert.equal(exact.state.lodging.address.length, LODGING_ADDRESS_MAX);
  for (const address of [12, { street: 'x' }, ['札幌']]) {
    const result = applyLodgingPatch(state, samplePatch({ address }));
    assert.equal(result.ok, false);
    assert.equal(result.error, '住宿格式不正確');
  }
  assert.equal(state.lodging.name, 'Minn 札幌大通 西14');
});

test('applyLodgingPatch requires finite coordinates inside Hokkaido', () => {
  const state = createSeedState();
  const bad = [
    { lat: Number.NaN, lng: 141.35 },
    { lat: Number.POSITIVE_INFINITY, lng: 141.35 },
    { lat: 43.06, lng: Number.NEGATIVE_INFINITY },
    { lat: '43.06', lng: 141.35 },
    { lat: null, lng: 141.35 },
    { lat: undefined, lng: 141.35 },
  ];
  for (const coords of bad) {
    const result = applyLodgingPatch(state, samplePatch(coords));
    assert.equal(result.ok, false, JSON.stringify(coords));
    assert.equal(result.error, '座標不完整');
  }
  const tokyo = applyLodgingPatch(state, samplePatch({ lat: 35.6812, lng: 139.7671 }));
  assert.equal(tokyo.ok, false);
  assert.equal(tokyo.error, '座標超出範圍');
  const south = applyLodgingPatch(state, samplePatch({ lat: 41.19, lng: 141.35 }));
  assert.equal(south.ok, false);
  assert.equal(south.error, '座標超出範圍');
  const edge = applyLodgingPatch(state, samplePatch({ lat: 41.2, lng: 139.2 }));
  assert.equal(edge.ok, true);
  assert.equal(edge.state.lodging.lat, 41.2);
  assert.equal(edge.state.lodging.lng, 139.2);
  const northEast = applyLodgingPatch(state, samplePatch({ lat: 45.7, lng: 146.2 }));
  assert.equal(northEast.ok, true);
  assert.equal(state.stops, edge.state.stops);
});

test('applyLodgingPatch rejects a patch that is not an object', () => {
  const state = createSeedState();
  for (const patch of [null, undefined, '住宿', 1, ['name']]) {
    const result = applyLodgingPatch(state, patch);
    assert.equal(result.ok, false);
    assert.equal(result.error, '住宿格式不正確');
  }
  assert.equal(applyLodgingPatch(null, samplePatch()).ok, false);
  assert.equal(state.lodging.name, 'Minn 札幌大通 西14');
});
