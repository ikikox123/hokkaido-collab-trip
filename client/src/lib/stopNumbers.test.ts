import test from 'node:test';
import assert from 'node:assert/strict';
import { displayStopTitle } from '../i18n/stopNames.ts';
import type { Locale } from '../i18n/messages.ts';
import { stopMarkerTitle } from './stopMarker.ts';
import { stopNumberById } from './stopNumbers.ts';

const day1 = (id: string) => ({ id, day: 1 });
const day2 = (id: string) => ({ id, day: 2 });

test('numbers follow the current day order and each day restarts at 1', () => {
  const numbers = stopNumberById([
    day1('a'),
    day1('b'),
    day1('c'),
    day2('d'),
    day2('e'),
  ]);
  assert.equal(numbers.get('a'), 1);
  assert.equal(numbers.get('b'), 2);
  assert.equal(numbers.get('c'), 3);
  assert.equal(numbers.get('d'), 1);
  assert.equal(numbers.get('e'), 2);
});

test('interleaved days still restart at 1 in encounter order', () => {
  const numbers = stopNumberById([
    day1('a'),
    day2('c'),
    day1('b'),
    day2('d'),
  ]);
  assert.equal(numbers.get('a'), 1);
  assert.equal(numbers.get('b'), 2);
  assert.equal(numbers.get('c'), 1);
  assert.equal(numbers.get('d'), 2);
});

test('recomputes after reorder, add, and delete', () => {
  let stops = [day1('a'), day1('b'), day1('c')];
  assert.deepEqual(
    stops.map((stop) => stopNumberById(stops).get(stop.id)),
    [1, 2, 3],
  );

  stops = [stops[2], stops[0], stops[1]];
  let numbers = stopNumberById(stops);
  assert.equal(numbers.get('c'), 1);
  assert.equal(numbers.get('a'), 2);
  assert.equal(numbers.get('b'), 3);

  stops = [stops[0], day1('d'), stops[1], stops[2]];
  numbers = stopNumberById(stops);
  assert.deepEqual(
    stops.map((stop) => numbers.get(stop.id)),
    [1, 2, 3, 4],
  );
  assert.equal(numbers.get('d'), 2);

  stops = stops.filter((stop) => stop.id !== 'a');
  numbers = stopNumberById(stops);
  assert.deepEqual(
    stops.map((stop) => numbers.get(stop.id)),
    [1, 2, 3],
  );
  assert.equal(numbers.get('c'), 1);
  assert.equal(numbers.get('d'), 2);
  assert.equal(numbers.get('b'), 3);
  assert.equal(numbers.has('a'), false);

  const nextDay = stopNumberById([...stops, day2('e'), day2('f')]);
  assert.equal(nextDay.get('e'), 1);
  assert.equal(nextDay.get('f'), 2);
  assert.equal(nextDay.get('c'), 1);
});

test('day numbers stay the same when stop names switch language', () => {
  const stops = [
    { id: 's7', day: 2, title: '札幌時計台' },
    { id: 's8', day: 2, title: '札幌電視塔' },
    { id: 's1', day: 1, title: '新千歲機場 CTS 抵達' },
  ];
  const locales: Locale[] = ['zh-Hant', 'ja', 'en'];
  const shown = locales.map((locale) =>
    stops.map((stop) => displayStopTitle(locale, stop.title)),
  );
  assert.notEqual(shown[0][0], shown[1][0]);
  assert.notEqual(shown[1][0], shown[2][0]);

  const numbered = locales.map((locale) => {
    const labeled = stops.map((stop) => ({
      ...stop,
      title: displayStopTitle(locale, stop.title),
    }));
    return stopNumberById(labeled);
  });
  for (const numbers of numbered) {
    assert.equal(numbers.get('s7'), 1);
    assert.equal(numbers.get('s8'), 2);
    assert.equal(numbers.get('s1'), 1);
  }
  assert.equal(stopMarkerTitle(1, shown[0][0]), '1. 札幌時計台');
  assert.equal(stopMarkerTitle(1, shown[1][0]), '1. 札幌市時計台');
  assert.equal(stopMarkerTitle(1, shown[2][0]), '1. Sapporo Clock Tower');
  assert.equal(stopMarkerTitle(2, shown[2][1]).startsWith('2. '), true);
});
