import test from 'node:test';
import assert from 'node:assert/strict';
import { stopInfoPatch, stopInfoView } from './stopInfo.ts';

const legacy = { id: 's1', day: 1, date: '2027-02-12', title: '舊站點', time: '10:00', lat: 43, lng: 141 };

test('legacy stops (no keys, or notes "") show nothing and are not rewritten', () => {
  assert.deepEqual(stopInfoView(legacy), { hours: '', notes: '' });
  assert.deepEqual(stopInfoView({ ...legacy, notes: '' }), { hours: '', notes: '' });
  assert.deepEqual(stopInfoView(null), { hours: '', notes: '' });
  assert.deepEqual(stopInfoView({ hours: 42, notes: null }), { hours: '', notes: '' });
  const before = JSON.stringify(legacy);
  const same = stopInfoPatch(legacy, { hours: '  ', notes: '\n ' });
  assert.deepEqual(same, { ok: true, patch: {} });
  assert.equal(JSON.stringify(legacy), before);
});

test('patch only carries what changed; clearing sends an empty string', () => {
  const stop = { ...legacy, hours: '9-5', notes: '預約' };
  assert.deepEqual(stopInfoPatch(stop, { hours: '9-5', notes: '預約' }), { ok: true, patch: {} });
  assert.deepEqual(stopInfoPatch(stop, { hours: ' 10-6 ', notes: '預約' }), { ok: true, patch: { hours: '10-6' } });
  assert.deepEqual(stopInfoPatch(stop, { hours: '', notes: '預約' }), { ok: true, patch: { hours: '' } });
  assert.deepEqual(stopInfoPatch(legacy, { hours: '', notes: '新備註' }), { ok: true, patch: { notes: '新備註' } });
});

test('patch refuses what the server would refuse', () => {
  assert.equal(stopInfoPatch(legacy, { hours: 'x'.repeat(81), notes: '' }).ok, false);
  assert.equal(stopInfoPatch(legacy, { hours: '', notes: 'a\nb\nc\nd' }).ok, false);
  assert.equal(stopInfoPatch(legacy, { hours: '', notes: '雪'.repeat(301) }).ok, false);
});
