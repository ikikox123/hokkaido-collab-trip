import test from 'node:test';
import assert from 'node:assert/strict';
import { SAPPORO_BASE } from './dayView.ts';
import { isSharePath, parseShareScope, shareLocation } from './sharePath.ts';
import {
  formatLodgingPoint,
  formatShareDate,
  isShareTrip,
  shareDayHeading,
  shareDays,
  shareLodgingDisplay,
  shareStopDisplay,
  shareTripSubtitle,
  type ShareTrip,
} from './shareView.ts';

const trip: ShareTrip = {
  tripName: '瘋瘋火火北海道冒險記｜6 人｜2027-02-12～18',
  lodging: {
    name: 'Minn 札幌大通 西14',
    address: '南1条西14丁目1-235',
    lat: 43.057291,
    lng: 141.336603,
  },
  days: [
    { day: 1, date: '2027-02-12', label: 'D1 抵達' },
    { day: 2, date: '2027-02-13', label: 'D2 札幌' },
  ],
  stops: [
    { id: 'late', day: 1, date: '2027-02-12', title: '札幌時計台', time: '18:00', notes: '圓山' },
    { id: 'early', day: 1, date: '2027-02-12', title: '新千歲機場 CTS 抵達', time: '15:00', notes: 'RMQ 10:20 → CTS 15:00' },
    { id: 'day2', day: 2, date: '2027-02-13', title: '北海道神宮', time: '13:30', notes: '校園散步' },
  ],
};

test('share path accepts the sheet and rejects the collaborative routes', () => {
  assert.equal(isSharePath('/share'), true);
  assert.equal(isSharePath('/share/'), true);
  assert.equal(isSharePath('/'), false);
  assert.equal(isSharePath('/split'), false);
  assert.equal(isSharePath('/share/2'), false);
});

test('day query selects one day and a blank query selects the whole trip', () => {
  assert.deepEqual(parseShareScope(''), { kind: 'all' });
  assert.deepEqual(parseShareScope('?day='), { kind: 'all' });
  assert.deepEqual(parseShareScope('?day=2'), { kind: 'day', day: 2 });
  assert.deepEqual(parseShareScope('?day=0'), { kind: 'day', day: 0 });
  assert.deepEqual(parseShareScope('?day=abc'), { kind: 'day', day: 0 });
  assert.equal(shareLocation({ kind: 'all' }), '/share');
  assert.equal(shareLocation({ kind: 'day', day: 3 }), '/share?day=3');
});

test('stop numbers follow list order inside each day, not clock time', () => {
  const all = shareDays(trip, { kind: 'all' });
  assert.equal(all.unknownDay, false);
  assert.deepEqual(
    all.days.map((block) => block.stops.map((row) => [row.stop.id, row.number])),
    [
      [
        ['late', 1],
        ['early', 2],
      ],
      [['day2', 1]],
    ],
  );

  const one = shareDays(trip, { kind: 'day', day: 2 });
  assert.equal(one.days.length, 1);
  assert.equal(one.days[0].stops[0].number, 1);
  assert.equal(one.days[0].stops[0].stop.notes, '校園散步');

  const missing = shareDays(trip, { kind: 'day', day: 9 });
  assert.equal(missing.unknownDay, true);
  assert.equal(missing.days.length, 0);
});

test('stop names follow the locale and notes, day suffixes, and lodging stay stored', () => {
  const stop = trip.stops[0];
  const zh = shareStopDisplay('zh-Hant', stop, 1);
  const ja = shareStopDisplay('ja', stop, 1);
  const en = shareStopDisplay('en', stop, 1);
  assert.equal(zh.title, '札幌時計台');
  assert.equal(ja.title, '札幌市時計台');
  assert.equal(en.title, 'Sapporo Clock Tower');
  assert.equal(zh.notes, '圓山');
  assert.equal(ja.notes, '圓山');
  assert.equal(en.notes, '圓山');
  assert.equal(zh.time, '18:00');

  const heading = shareDayHeading('en', trip.days[0]);
  assert.equal(heading.title, 'Day 1 抵達');
  assert.equal(heading.title.endsWith(' 抵達'), true);
  assert.equal(shareDayHeading('ja', trip.days[1]).title, '2日目 札幌');
  assert.equal(formatShareDate('en', '2027-02-12').startsWith('2027-02-12'), true);
  assert.equal(formatShareDate('zh-Hant', 'not-a-date'), 'not-a-date');

  const stay = shareLodgingDisplay(trip.lodging);
  assert.equal(stay.name, 'Minn 札幌大通 西14');
  assert.equal(stay.address, '南1条西14丁目1-235');
  assert.equal(stay.usedBaseFallback, false);
  assert.equal(formatLodgingPoint(stay.point), '43.057291, 141.336603');
  assert.equal(shareTripSubtitle(trip.tripName), '6 人｜2027-02-12～18');

  const before = structuredClone(trip);
  shareDays(trip, { kind: 'all' });
  shareStopDisplay('ja', stop, 1);
  shareDayHeading('en', trip.days[0]);
  assert.deepEqual(trip, before);
});

test('missing lodging coordinates fall back to the Sapporo base point', () => {
  const stay = shareLodgingDisplay({ name: 'Minn', address: '', lat: Number.NaN, lng: 1 });
  assert.deepEqual(stay.point, SAPPORO_BASE);
  assert.equal(stay.usedBaseFallback, true);
  assert.equal(stay.name, 'Minn');
  assert.deepEqual(shareLodgingDisplay(undefined).point, SAPPORO_BASE);
  assert.equal(isShareTrip({ days: [], stops: [] }), true);
  assert.equal(isShareTrip({ stops: [] }), false);
  assert.equal(isShareTrip(null), false);
});
