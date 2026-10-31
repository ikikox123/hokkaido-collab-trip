import test from 'node:test';
import assert from 'node:assert/strict';
import { areaLine, groupByArea, nextStopTime, stopFromSaved, shortAddress, type SavedPlace } from './saved.ts';

const place = (over: Partial<SavedPlace>): SavedPlace => ({
  id: 'a', scope: 'personal', name: 'N', type: 'eat', country: '日本', city: '札幌', district: '中央区', address: '',
  lat: 43.05, lng: 141.35, status: 'ready', confidence: 0.9, sourceUrl: null, mapsUrl: '', hasText: false,
  createdAt: '', updatedAt: '', ...over,
});

test('groups by city, then district; a city without districts is one group', () => {
  const groups = groupByArea([
    place({ id: '1', district: '', city: '' }),
    place({ id: '2', district: '中央区' }),
    place({ id: '3', district: '', city: '小樽市' }),
    place({ id: '4', district: '色内', city: '小樽' }),
    place({ id: '5', district: '北区' }),
    place({ id: '6', district: '中央区北1条西3丁目', city: '札幌市' }),
    place({ id: '7', district: '狸小路' }),
    place({ id: '8', district: '中央区', city: '' }),
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.places.map((p) => p.id)]), [
    ['札幌市 › 中央区', ['2', '6']],
    ['札幌市 › 北区', ['5']],
    ['札幌市', ['7']],
    ['小樽市', ['3', '4']],
    ['中央区', ['8']],
    [null, ['1']],
  ]);
});

test('area line skips empty parts and shows the city with 市', () => {
  assert.equal(areaLine(place({ district: '' })), '札幌市');
  assert.equal(areaLine(place({ city: '', district: '' })), '');
  assert.equal(areaLine(place({})), '札幌市・中央区');
  assert.equal(areaLine(place({ city: '札幌', district: '中央区北1条西3丁目' })), '札幌市・中央区');
  assert.equal(areaLine(place({ city: '小樽', district: '色内' })), '小樽市');
});

test('stop fields use the place coordinates, or the fallback when it has none', () => {
  const fallback = { lat: 1, lng: 2 };
  const located = stopFromSaved(place({ address: '北海道札幌市' }), fallback, '吃');
  assert.deepEqual([located.lat, located.lng, located.located, located.notes], [43.05, 141.35, true, '吃・札幌市・中央区']);
  const missing = stopFromSaved(place({ lat: null, lng: null }), fallback, null);
  assert.deepEqual([missing.lat, missing.lng, missing.located, missing.notes], [1, 2, false, '（待確認位置）札幌市・中央区']);
  assert.ok(stopFromSaved(place({ address: 'x'.repeat(500) }), fallback, null).notes.length <= 300);
});

test('short address: city・district, never the full OSM name', () => {
  const full = '色内, 小樽市, 後志総合振興局, 北海道, 047-0031, 日本';
  assert.equal(stopFromSaved(place({ city: '小樽', district: '色内', address: full, precision: 'place' }), { lat: 1, lng: 2 }, null).notes, '小樽市');
  assert.equal(stopFromSaved(place({ city: '', district: '', address: full, precision: 'place' }), { lat: 1, lng: 2 }, null).notes, '色内・小樽市');
  assert.equal(stopFromSaved(place({ address: full, precision: 'area' }), { lat: 1, lng: 2 }, null).notes.includes('日本'), false);
  assert.equal(shortAddress('札幌市, 北海道地方, 日本'), '札幌市');
});

test('exact place: no pending prefix, and no map link in the note', () => {
  const link = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent('味の時計台 駅前通り総本店 中央区 札幌市');
  const f = stopFromSaved(place({ precision: 'place', address: '札幌市', mapsUrl: link }), { lat: 1, lng: 2 }, '吃');
  assert.equal(f.notes, '吃・札幌市・中央区');
  assert.ok(!f.notes.includes('http') && !f.notes.includes('%'));
});

test('area precision, no coordinates, or pending status get the confirm prefix', () => {
  const fb = { lat: 1, lng: 2 };
  for (const p of [place({ precision: 'area' }), place({ lat: null, lng: null }), place({ status: 'pending' })]) {
    assert.ok(stopFromSaved(p, fb, '吃', '（待確認位置）').notes.startsWith('（待確認位置）吃・'));
  }
  assert.ok(!stopFromSaved(place({}), fb, '吃').notes.startsWith('（待確認'));
});

test('notes stay within 300 characters', () => {
  const long = stopFromSaved(place({ precision: 'area', address: '道'.repeat(600), mapsUrl: 'https://x/' + 'z'.repeat(400) }), { lat: 1, lng: 2 }, '吃');
  assert.ok(Array.from(long.notes).length <= 300);
  assert.ok(!long.notes.includes('https://'));
});

test('next stop time is the last stop plus one hour, capped at 23:00', () => {
  assert.equal(nextStopTime(undefined), '12:00');
  assert.equal(nextStopTime('abc'), '12:00');
  assert.equal(nextStopTime('09:30'), '10:30');
  assert.equal(nextStopTime('9:05'), '10:05');
  assert.equal(nextStopTime('22:30'), '23:00');
  assert.equal(nextStopTime('23:00'), '23:00');
});
