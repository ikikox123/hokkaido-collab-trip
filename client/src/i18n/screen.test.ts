import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDocumentTitle, displayDayLabel, documentTitleFor, pageHeading } from './screen.ts';
import type { Locale } from './messages.ts';

const TITLES: Record<Locale, string> = {
  'zh-Hant': '瘋瘋火火北海道冒險記',
  ja: '北海道アドベンチャー（瘋瘋火火）',
  en: 'Hokkaido Adventure (Fengfeng Huohuo)',
};

const LOCALES: Locale[] = ['zh-Hant', 'ja', 'en'];

test('page heading and document title follow the active locale', () => {
  for (const locale of LOCALES) {
    const doc = { title: 'previous' };
    assert.equal(pageHeading(locale), TITLES[locale]);
    assert.equal(documentTitleFor(locale), TITLES[locale]);
    applyDocumentTitle(locale, doc);
    assert.equal(doc.title, TITLES[locale]);
  }
});

test('day buttons change only the day-number prefix', () => {
  const rows: Array<[string, string, string, string]> = [
    ['D1 抵達', 'D1 抵達', '1日目 抵達', 'Day 1 抵達'],
    ['D2 札幌', 'D2 札幌', '2日目 札幌', 'Day 2 札幌'],
    ['D3 旭川', 'D3 旭川', '3日目 旭川', 'Day 3 旭川'],
    ['D4 滑雪', 'D4 滑雪', '4日目 滑雪', 'Day 4 滑雪'],
    ['D5 小樽', 'D5 小樽', '5日目 小樽', 'Day 5 小樽'],
    ['D6 彈性', 'D6 彈性', '6日目 彈性', 'Day 6 彈性'],
    ['D7 起飛', 'D7 起飛', '7日目 起飛', 'Day 7 起飛'],
    ['D8 夜航', 'D8 夜航', '8日目 夜航', 'Day 8 夜航'],
  ];
  for (const [stored, zh, ja, en] of rows) {
    assert.equal(displayDayLabel('zh-Hant', stored), zh);
    assert.equal(displayDayLabel('ja', stored), ja);
    assert.equal(displayDayLabel('en', stored), en);
  }
});

test('stored trip name, day labels, and suffix text are not rewritten', () => {
  const stored = {
    tripName: '瘋瘋火火北海道冒險記｜6 人｜2027-02-12～18',
    days: [
      { day: 1, label: 'D1 抵達' },
      { day: 2, label: 'D2 札幌' },
      { day: 3, label: 'D3 旭川' },
      { day: 4, label: 'D4 滑雪' },
      { day: 5, label: 'D5 小樽' },
      { day: 6, label: 'D6 彈性' },
      { day: 7, label: 'D7 起飛' },
    ],
  };
  const before = structuredClone(stored);
  const doc = { title: '' };

  for (const locale of LOCALES) {
    pageHeading(locale);
    applyDocumentTitle(locale, doc);
    for (const day of stored.days) {
      const shown = displayDayLabel(locale, day.label);
      const suffix = day.label.slice(day.label.match(/^D\d+/)?.[0].length ?? 0);
      assert.equal(shown.endsWith(suffix), true);
      assert.equal(suffix.includes('｜'), false);
    }
  }

  assert.deepEqual(stored, before);
  assert.equal(stored.tripName, '瘋瘋火火北海道冒險記｜6 人｜2027-02-12～18');
  assert.equal(stored.days.map((day) => day.label).join('|'), before.days.map((day) => day.label).join('|'));
  assert.equal(pageHeading('ja').includes('6 人'), false);
  assert.equal(documentTitleFor('en').includes('2027-02-12'), false);
  assert.equal(stored.tripName.split('｜').slice(1).join('｜'), '6 人｜2027-02-12～18');
});
