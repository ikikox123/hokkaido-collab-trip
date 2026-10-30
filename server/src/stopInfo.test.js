import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from './seed.js';
import { applyStopPatch } from './stopEdit.js';
import { toPublicShare } from './shareTrip.js';
import { cleanStopHours, cleanStopNote, cleanStopInfo, STOP_HOURS_MAX, STOP_NOTE_MAX } from './stopInfo.js';

test('hours: trimmed, one line, controls and bidi characters removed', () => {
  assert.deepEqual(cleanStopHours('  09:00 -\n 18:00\t(L.O. 17:30) '), { ok: true, value: '09:00 - 18:00 (L.O. 17:30)' });
  assert.deepEqual(cleanStopHours('10:00‮-​17:00\u0000'), { ok: true, value: '10:00-17:00' });
  assert.deepEqual(cleanStopHours('   '), { ok: true, value: '' });
  assert.deepEqual(cleanStopHours(null), { ok: true, value: '' });
  assert.equal(cleanStopHours(42).ok, false);
});

test('hours: limit counts characters, not UTF-16 units', () => {
  assert.equal(cleanStopHours('🕘'.repeat(STOP_HOURS_MAX)).ok, true);
  assert.equal(cleanStopHours('🕘'.repeat(STOP_HOURS_MAX + 1)).ok, false);
});

test('note: keeps up to three lines, drops blank lines, folds spaces', () => {
  assert.deepEqual(cleanStopNote(' 集合  在 門口 \r\n\r\n 帶現金\n​預約制 '), { ok: true, value: '集合 在 門口\n帶現金\n預約制' });
  assert.equal(cleanStopNote('a\nb\nc\nd').ok, false);
  assert.equal(cleanStopNote('雪'.repeat(STOP_NOTE_MAX)).ok, true);
  assert.equal(cleanStopNote('雪'.repeat(STOP_NOTE_MAX + 1)).ok, false);
  assert.deepEqual(cleanStopNote('\n \n'), { ok: true, value: '' });
});

test('cleanStopInfo only looks at keys that are present', () => {
  assert.deepEqual(cleanStopInfo({}), { ok: true, set: {}, remove: [] });
  assert.deepEqual(cleanStopInfo({ hours: ' 9-5 ', notes: '' }), { ok: true, set: { hours: '9-5' }, remove: ['notes'] });
  assert.equal(cleanStopInfo({ hours: 'x'.repeat(81) }).ok, false);
});

test('applyStopPatch writes hours and notes, and removes them when emptied', () => {
  const state = createSeedState();
  const set = applyStopPatch(state, 's18', { hours: ' 9:00-17:00 ', notes: ' 預約\n帶護照 ' });
  assert.equal(set.ok, true);
  assert.equal(set.titleOnly, true, 'text-only edits do not recompute routes');
  const stop = set.state.stops.find((s) => s.id === 's18');
  assert.equal(stop.hours, '9:00-17:00');
  assert.equal(stop.notes, '預約\n帶護照');
  assert.equal(state.stops.find((s) => s.id === 's18').hours, undefined, 'input state is not mutated');

  const cleared = applyStopPatch(set.state, 's18', { hours: '  ', notes: null });
  assert.equal(cleared.ok, true);
  const after = cleared.state.stops.find((s) => s.id === 's18');
  assert.equal('hours' in after, false);
  assert.equal('notes' in after, false);
});

test('applyStopPatch rejects bad hours or notes and leaves other fields in the same patch unapplied', () => {
  const state = createSeedState();
  const long = applyStopPatch(state, 's7', { title: '新名', hours: 'x'.repeat(STOP_HOURS_MAX + 1) });
  assert.equal(long.ok, false);
  assert.match(long.error, /80/);
  assert.equal(applyStopPatch(state, 's7', { notes: 'a\nb\nc\nd' }).ok, false);
  assert.equal(applyStopPatch(state, 'nope', { hours: '9-5' }).ok, false);
});

test('legacy stops: unrelated edits never add hours or notes keys', () => {
  const legacy = {
    ...createSeedState(),
    stops: [{ id: 'old', day: 1, date: '2027-02-12', title: '舊站點', time: '10:00', lat: 43.06, lng: 141.35 }],
    legs: [],
  };
  const before = JSON.stringify(legacy.stops);
  for (const patch of [{ title: '改名' }, { time: '11:00' }, { lat: 43.1, lng: 141.4 }, { title: 'x', time: '12:00' }]) {
    const result = applyStopPatch(legacy, 'old', patch);
    assert.equal(result.ok, true);
    const stop = result.state.stops[0];
    assert.equal('hours' in stop, false);
    assert.equal('notes' in stop, false);
  }
  assert.equal(JSON.stringify(legacy.stops), before);
});

test('legacy stop with notes "" or no notes: clearing is a no-op, stored shape is kept', () => {
  const state = { ...createSeedState() };
  const withEmpty = applyStopPatch(state, 's18', { notes: '', hours: '' });
  assert.equal(withEmpty.unchanged, true);
  assert.equal(withEmpty.state, state);
  const s1 = state.stops.find((s) => s.id === 's1');
  const kept = applyStopPatch(state, 's1', { time: '16:00' });
  assert.equal(kept.state.stops.find((s) => s.id === 's1').notes, s1.notes, 'existing notes survive other edits');
});

test('public share output keeps the old shape unless a stop has hours', () => {
  const state = {
    ...createSeedState(),
    stops: [
      { id: 'a', day: 1, date: '2027-02-12', title: 'A', time: '10:00', lat: 43, lng: 141, notes: '' },
      { id: 'b', day: 1, date: '2027-02-12', title: 'B', time: '11:00', lat: 43, lng: 141, notes: 'n', hours: '9-5' },
    ],
  };
  const [a, b] = toPublicShare(state).stops;
  assert.equal('hours' in a, false);
  assert.equal(b.hours, '9-5');
  assert.equal(b.notes, 'n');
});
