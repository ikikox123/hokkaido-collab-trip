import test from 'node:test';
import assert from 'node:assert/strict';
import { activeWarningSummary, jrOneLiner, weatherTempLine } from './alertSummary.ts';

test('weather temps collapse to a single Traditional Chinese line', () => {
  assert.equal(
    weatherTempLine([
      { name: '札幌', temperature: 8.6 },
      { name: '小樽', temperature: 9.8 },
      { name: '旭川', temperature: null },
    ]),
    '札幌 9° · 小樽 10° · 旭川 —',
  );
  assert.equal(weatherTempLine([]), '');
});

test('active warnings become a count plus short area names', () => {
  const summary = activeWarningSummary([
    { name: '札幌', active: [] },
    { name: '小樽', active: [{ name: '波浪注意報' }, { name: '強風注意報' }] },
    { name: '旭川', active: [{ name: '大雪警報' }] },
    { name: '美瑛', active: [{ name: '大雪警報' }] },
  ]);
  assert.equal(summary.count, 4);
  assert.equal(summary.label, '小樽波浪注意報、小樽強風注意報、旭川大雪警報等 1 項');
});

test('JR one-liner prefers a shared calm label, otherwise names disruptions', () => {
  assert.equal(
    jrOneLiner(
      [
        { name: '札幌近郊', status: 2, label: '服務時間外' },
        { name: '道央', status: 2, label: '服務時間外' },
      ],
      true,
    ),
    'JR 服務時間外',
  );
  assert.equal(
    jrOneLiner(
      [
        { name: '札幌近郊', status: 1, label: '停駛、延遲30分鐘以上、暫停行駛' },
        { name: '道央', status: 0, label: '無停駛、延遲訊息' },
      ],
      true,
    ),
    'JR 有影響：札幌近郊',
  );
  assert.equal(jrOneLiner([], false), 'JR 暫時無法更新');
  assert.equal(jrOneLiner([], undefined), 'JR 運行資訊載入中');
});
