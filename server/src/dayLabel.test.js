import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from './seed.js';
import { applyDayLabel, cleanDayLabel, DAY_LABEL_MAX, dayLabelLength, defaultDayLabel } from './dayLabel.js';

test('cleanDayLabel trims, folds whitespace, and strips control characters', () => {
  assert.deepEqual(cleanDayLabel('  札幌   雪祭り  '), { ok: true, label: '札幌 雪祭り' });
  assert.deepEqual(cleanDayLabel('小樽\u0000\u0007運河​‮'), { ok: true, label: '小樽運河' });
  assert.deepEqual(cleanDayLabel('a\tb\nc'), { ok: true, label: 'abc' });
  assert.deepEqual(cleanDayLabel(null), { ok: true, label: '' });
  assert.deepEqual(cleanDayLabel(undefined), { ok: true, label: '' });
  assert.equal(cleanDayLabel(42).ok, false);
  assert.equal(cleanDayLabel({ label: 'x' }).ok, false);
});

test('length counts code points so CJK and emoji are one character each', () => {
  assert.equal(DAY_LABEL_MAX, 24);
  assert.equal(dayLabelLength('🦊🍜❄'), 3);
  const atLimit = '雪'.repeat(DAY_LABEL_MAX - 1) + '🦊';
  assert.equal(cleanDayLabel(atLimit).ok, true);
  const over = '雪'.repeat(DAY_LABEL_MAX) + '🦊';
  const result = cleanDayLabel(over);
  assert.equal(result.ok, false);
  assert.match(result.error, /24/);
  // Surrounding spaces do not count toward the limit.
  assert.equal(cleanDayLabel(`  ${'a'.repeat(DAY_LABEL_MAX)}  `).ok, true);
  // Joined emoji keep their joiner.
  assert.equal(cleanDayLabel('👨‍👩‍👧').label, '👨‍👩‍👧');
});

test('applyDayLabel renames only that day and keeps everything else', () => {
  const state = createSeedState();
  const result = applyDayLabel(state, { day: 2, label: ' 札幌 雪祭り ' });
  assert.equal(result.ok, true);
  assert.equal(result.unchanged, false);
  assert.equal(result.label, '札幌 雪祭り');
  assert.equal(result.state.days[1].label, '札幌 雪祭り');
  assert.equal(result.state.days[1].date, state.days[1].date);
  assert.equal(result.state.days[1].day, 2);
  for (const i of [0, 2, 3, 4, 5, 6]) assert.equal(result.state.days[i], state.days[i]);
  assert.equal(result.state.stops, state.stops);
  assert.equal(result.state.legs, state.legs);
  assert.equal(result.state.members, state.members);
  assert.equal(result.state.lodging, state.lodging);
  // input state is not mutated
  assert.equal(state.days[1].label, 'D2 札幌');
});

test('blank input resets to D{n} by position', () => {
  const state = createSeedState();
  assert.equal(defaultDayLabel(3), 'D3');
  assert.equal(applyDayLabel(state, { day: 3, label: '   ' }).state.days[2].label, 'D3');
  assert.equal(applyDayLabel(state, { day: 3, label: '' }).state.days[2].label, 'D3');
  assert.equal(applyDayLabel(state, { day: 3, label: '\u0000' }).state.days[2].label, 'D3');
  // n is the 1-based position even if day ids are not 1..n
  const odd = { ...state, days: [{ day: 10, date: '2027-01-01', label: 'X' }, { day: 20, date: '2027-01-02', label: 'Y' }] };
  assert.equal(applyDayLabel(odd, { day: 20, label: '' }).state.days[1].label, 'D2');
});

test('applyDayLabel reports unchanged and rejects bad input without touching state', () => {
  const state = createSeedState();
  const same = applyDayLabel(state, { day: 1, label: ' D1 抵達 ' });
  assert.equal(same.ok, true);
  assert.equal(same.unchanged, true);
  assert.equal(same.state, state);

  for (const patch of [{ day: 99, label: 'x' }, { day: '2', label: 'x' }, { day: 1.5, label: 'x' }, {}, null]) {
    const result = applyDayLabel(state, patch);
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.state, undefined);
  }
  const long = applyDayLabel(state, { day: 1, label: 'x'.repeat(DAY_LABEL_MAX + 1) });
  assert.equal(long.ok, false);
  assert.equal(applyDayLabel(null, { day: 1, label: 'x' }).ok, false);
  assert.equal(applyDayLabel({ stops: [] }, { day: 1, label: 'x' }).ok, false);
  assert.equal(state.days[0].label, 'D1 抵達');
});
