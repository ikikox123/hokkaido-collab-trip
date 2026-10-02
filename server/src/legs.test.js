import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from './seed.js';
import {
  buildSummary,
  estimateFromRoute,
  reconcileLegs,
  setLegMode,
} from './legs.js';

test('day 2 Sapporo legs default to walk and subway', () => {
  const state = createSeedState();
  const stops = state.stops.filter((s) => s.day === 2);
  const modes = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const leg = state.legs.find((l) => l.fromStopId === stops[i].id && l.toStopId === stops[i + 1].id);
    assert.ok(leg, `missing leg ${stops[i].id}->${stops[i + 1].id}`);
    modes.push(leg.mode);
  }
  assert.deepEqual(modes, ['walk', 'walk', 'subway', 'subway', 'subway', 'subway', 'walk']);
});

test('subway duration is a speed estimate, not the driving duration', () => {
  const est = estimateFromRoute('subway', 3200, 400);
  assert.equal(est.distanceM, 3200);
  assert.notEqual(est.durationSec, 400);
  assert.ok(est.durationSec > 400);
  const summary = buildSummary('subway', est.durationSec, est.distanceM);
  assert.match(summary, /建議地鐵（估算非時刻表）/);
  assert.match(summary, /3\.2 km/);
  assert.match(summary, /^約 /);
});

test('walk summary uses the walking label without the transit disclaimer', () => {
  const summary = buildSummary('walk', 480, 650);
  assert.equal(summary, '約 8 分・650 m・步行');
});

test('Google transit success drops the timetable disclaimer; driving fallback is labeled', () => {
  const live = buildSummary('subway', 900, 3200, { liveTransit: true });
  assert.equal(live.includes('估算'), false);
  assert.match(live, /建議地鐵/);
  const fallback = buildSummary('jr', 1200, 8000, { estimateNote: '開車路徑估算' });
  assert.match(fallback, /建議 JR（開車路徑估算）/);
});

test('deleting a stop drops stale legs and bridges the new pair', () => {
  const state = createSeedState();
  state.stops = state.stops.filter((s) => s.id !== 's8');
  const legs = reconcileLegs(state);
  assert.equal(legs.some((l) => l.fromStopId === 's7' && l.toStopId === 's8'), false);
  assert.equal(legs.some((l) => l.fromStopId === 's8' && l.toStopId === 's9'), false);
  const bridged = legs.find((l) => l.fromStopId === 's7' && l.toStopId === 's9');
  assert.ok(bridged);
  assert.equal(bridged.mode, 'walk');
});

test('custom mode and estimate survive when the same pair stays adjacent', () => {
  const state = createSeedState();
  const leg = state.legs.find((l) => l.fromStopId === 's7' && l.toStopId === 's8');
  leg.mode = 'taxi';
  leg.distanceM = 420;
  leg.durationSec = 120;
  leg.summary = '約 2 分・420 m・計程車';
  leg.geometry = [[43.06, 141.35], [43.061, 141.356]];
  const kept = reconcileLegs(state).find((l) => l.fromStopId === 's7' && l.toStopId === 's8');
  assert.equal(kept.mode, 'taxi');
  assert.equal(kept.distanceM, 420);
  assert.equal(kept.geometry.length, 2);
});

test('an approximate driving fallback survives while the same pair stays adjacent', () => {
  const state = createSeedState();
  const leg = state.legs.find((l) => l.fromStopId === 's9' && l.toStopId === 's10');
  leg.approximate = true;
  leg.distanceM = 5000;
  leg.durationSec = 700;
  leg.summary = '約 12 分・5.0 km・建議地鐵（開車路徑估算）';
  leg.geometry = [[43.06, 141.35], [43.05, 141.31], [43.054, 141.308]];
  const kept = reconcileLegs(state).find((l) => l.fromStopId === 's9' && l.toStopId === 's10');
  assert.equal(kept.approximate, true);
  assert.equal(kept.geometry.length, 3);
});

test('changing mode clears the previous estimate', () => {
  const state = createSeedState();
  const leg = state.legs.find((l) => l.fromStopId === 's9' && l.toStopId === 's10');
  leg.distanceM = 5000;
  leg.durationSec = 900;
  leg.summary = '約 15 分・5.0 km・建議地鐵（估算非時刻表）';
  leg.geometry = [[43.06, 141.35], [43.05, 141.31]];
  const { state: next, changed } = setLegMode(state, 's9', 's10', 'taxi');
  assert.equal(changed, true);
  const updated = next.legs.find((l) => l.fromStopId === 's9' && l.toStopId === 's10');
  assert.equal(updated.mode, 'taxi');
  assert.equal(updated.distanceM, undefined);
  assert.equal(updated.geometry, undefined);
});
