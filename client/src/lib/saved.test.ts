import test from 'node:test';
import assert from 'node:assert/strict';
import { areaLine, groupByDistrict, stopFromSaved, type SavedPlace } from './saved.ts';

const place = (over: Partial<SavedPlace>): SavedPlace => ({
  id: 'a', scope: 'personal', name: 'N', type: 'eat', country: '日本', city: '札幌', district: '中央区', address: '',
  lat: 43.05, lng: 141.35, status: 'ready', confidence: 0.9, sourceUrl: null, mapsUrl: '', hasText: false,
  createdAt: '', updatedAt: '', ...over,
});

test('groups by district, then city, with no-area last and server order kept', () => {
  const groups = groupByDistrict([
    place({ id: '1', district: '', city: '' }),
    place({ id: '2', district: '中央区' }),
    place({ id: '3', district: '', city: '小樽' }),
    place({ id: '4', district: '中央区' }),
  ]);
  assert.deepEqual(groups.map((g) => [g.label, g.places.map((p) => p.id)]), [
    ['中央区', ['2', '4']],
    ['小樽', ['3']],
    [null, ['1']],
  ]);
});

test('area line skips empty parts', () => {
  assert.equal(areaLine(place({ district: '' })), '札幌');
  assert.equal(areaLine(place({ city: '', district: '' })), '');
  assert.equal(areaLine(place({})), '札幌・中央区');
});

test('stop fields use the place coordinates, or the fallback when it has none', () => {
  const fallback = { lat: 1, lng: 2 };
  const located = stopFromSaved(place({ address: '北海道札幌市' }), fallback, '吃');
  assert.deepEqual([located.lat, located.lng, located.located, located.notes], [43.05, 141.35, true, '吃・北海道札幌市']);
  const missing = stopFromSaved(place({ lat: null, lng: null }), fallback, null);
  assert.deepEqual([missing.lat, missing.lng, missing.located, missing.notes], [1, 2, false, '札幌・中央区']);
  assert.ok(stopFromSaved(place({ address: 'x'.repeat(500) }), fallback, null).notes.length <= 300);
});
