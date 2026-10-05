import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from './seed.js';
import { reconcileLegs } from './legs.js';
import { applyStopPatch, renameStop, STOP_TITLE_MAX } from './stopEdit.js';

function legWithEstimate(state) {
  const leg = state.legs.find((row) => row.fromStopId === 's7' && row.toStopId === 's8');
  leg.distanceM = 420;
  leg.durationSec = 300;
  leg.summary = '約 5 分・0.4 km・步行';
  leg.geometry = [
    [43.0625, 141.353611],
    [43.061092, 141.356433],
  ];
  return leg;
}

test('renameStop trims the title and leaves coordinates, notes, and legs alone', () => {
  const state = createSeedState();
  const before = state.stops.find((stop) => stop.id === 's7');
  const leg = legWithEstimate(state);
  const geometry = leg.geometry;
  const result = renameStop(state, 's7', '  札幌時計台（集合）  ');
  assert.equal(result.ok, true);
  assert.equal(result.titleOnly, true);
  const after = result.state.stops.find((stop) => stop.id === 's7');
  assert.equal(after.title, '札幌時計台（集合）');
  assert.equal(after.lat, before.lat);
  assert.equal(after.lng, before.lng);
  assert.equal(after.notes, before.notes);
  assert.equal(after.time, before.time);
  assert.equal(after.day, before.day);
  assert.equal(after.id, 's7');
  assert.equal(result.state.legs, state.legs);
  assert.equal(leg.distanceM, 420);
  assert.equal(leg.summary, '約 5 分・0.4 km・步行');
  assert.equal(leg.geometry, geometry);
  assert.equal(
    result.state.stops.find((stop) => stop.id === 's8'),
    state.stops.find((stop) => stop.id === 's8'),
  );
  const reconciled = reconcileLegs(result.state);
  const kept = reconciled.find((row) => row.fromStopId === 's7' && row.toStopId === 's8');
  assert.equal(kept.distanceM, 420);
  assert.equal(kept.summary, leg.summary);
  assert.deepEqual(kept.geometry, geometry);
});

test('renameStop rejects blank titles and does not mutate state', () => {
  const state = createSeedState();
  const title = state.stops.find((stop) => stop.id === 's7').title;
  for (const raw of ['', '   ', '\n\t', '\u3000', null, 12, {}]) {
    const result = renameStop(state, 's7', raw);
    assert.equal(result.ok, false);
    assert.equal(result.error, '地點名稱不可空白');
  }
  assert.equal(state.stops.find((stop) => stop.id === 's7').title, title);
});

test('renameStop rejects an overlong title and an unknown stop', () => {
  const state = createSeedState();
  const tooLong = renameStop(state, 's7', '名'.repeat(STOP_TITLE_MAX + 1));
  assert.equal(tooLong.ok, false);
  assert.equal(tooLong.error, '地點名稱過長');
  assert.equal(state.stops.find((stop) => stop.id === 's7').title, '札幌時計台');
  const missing = renameStop(state, 'missing', '新名稱');
  assert.equal(missing.ok, false);
  assert.equal(missing.error, '找不到站點');
});

test('renameStop reports unchanged when the trimmed title matches', () => {
  const state = createSeedState();
  const result = renameStop(state, 's7', '  札幌時計台  ');
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, true);
  assert.equal(result.state, state);
});

test('applyStopPatch title-only rename ignores coordinate fields that are not in the patch', () => {
  const state = createSeedState();
  const before = state.stops.find((stop) => stop.id === 's7');
  legWithEstimate(state);
  const result = applyStopPatch(state, 's7', { title: ' 時計台 ' });
  assert.equal(result.ok, true);
  assert.equal(result.titleOnly, true);
  const after = result.state.stops.find((stop) => stop.id === 's7');
  assert.equal(after.title, '時計台');
  assert.equal(after.lat, before.lat);
  assert.equal(after.lng, before.lng);
  assert.equal(result.state.legs.find((leg) => leg.fromStopId === 's7').distanceM, 420);
});

test('applyStopPatch still moves coordinates when lat/lng are part of the patch', () => {
  const state = createSeedState();
  legWithEstimate(state);
  const result = applyStopPatch(state, 's7', { title: ' 新地點 ', lat: 43.1, lng: 141.4 });
  assert.equal(result.titleOnly, false);
  const after = result.state.stops.find((stop) => stop.id === 's7');
  assert.equal(after.title, '新地點');
  assert.equal(after.lat, 43.1);
  assert.equal(after.lng, 141.4);
  const leg = result.state.legs.find((row) => row.fromStopId === 's7');
  assert.equal(leg.distanceM, undefined);
  assert.equal(leg.summary, undefined);
  assert.equal(leg.mode, 'walk');
});

test('applyStopPatch rejects a blank title even when coordinates are included', () => {
  const state = createSeedState();
  const before = state.stops.find((stop) => stop.id === 's7');
  const result = applyStopPatch(state, 's7', { title: '  ', lat: 43.1, lng: 141.4 });
  assert.equal(result.ok, false);
  assert.equal(before.lat, state.stops.find((stop) => stop.id === 's7').lat);
});

test('applyStopPatch copies only title, time, notes, and coordinates', () => {
  const state = createSeedState();
  const before = state.stops.find((stop) => stop.id === 's7');
  const result = applyStopPatch(state, 's7', {
    title: '新名稱',
    time: '09:30',
    notes: '門口集合',
    id: 'hacked',
    day: 9,
    date: '1999-01-01',
    secret: 'from-patch',
    members: [{ id: 'u9', username: 'eve' }],
    roomCode: 'LEAK',
  });
  assert.equal(result.ok, true);
  assert.equal(result.titleOnly, false);
  const after = result.state.stops.find((stop) => stop.id === 's7');
  assert.equal(after.id, 's7');
  assert.equal(after.title, '新名稱');
  assert.equal(after.time, '09:30');
  assert.equal(after.notes, '門口集合');
  assert.equal(after.day, before.day);
  assert.equal(after.date, before.date);
  assert.equal(after.lat, before.lat);
  assert.equal(after.lng, before.lng);
  assert.equal(after.secret, undefined);
  assert.equal(after.members, undefined);
  assert.equal(after.roomCode, undefined);
  assert.equal(state.stops.find((stop) => stop.id === 's7').title, before.title);
});

test('applyStopPatch treats unknown fields as a no-op and rejects coordinates outside range', () => {
  const state = createSeedState();
  const before = state.stops.find((stop) => stop.id === 's7');
  const ignored = applyStopPatch(state, 's7', { secret: 'x', members: [], id: 'other' });
  assert.equal(ignored.ok, true);
  assert.equal(ignored.unchanged, true);
  assert.equal(ignored.state, state);
  const range = applyStopPatch(state, 's7', { lat: 120, lng: 141 });
  assert.equal(range.ok, false);
  assert.equal(range.error, '座標超出範圍');
  assert.equal(state.stops.find((stop) => stop.id === 's7').lat, before.lat);
});
