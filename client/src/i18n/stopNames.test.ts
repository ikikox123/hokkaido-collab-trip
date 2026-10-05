import test from 'node:test';
import assert from 'node:assert/strict';
import { displayStopTitle, STOP_DISPLAY_NAMES } from './stopNames.ts';

const UNIQLO = 'uniqlo札幌三越店';

test('exact stored title hits the Japanese and English names', () => {
  assert.equal(displayStopTitle('ja', '札幌時計台'), '札幌市時計台');
  assert.equal(displayStopTitle('en', '札幌時計台'), 'Sapporo Clock Tower');
  assert.equal(displayStopTitle('ja', UNIQLO), 'ユニクロ 札幌三越店');
  assert.equal(displayStopTitle('en', UNIQLO), 'UNIQLO Sapporo Mitsukoshi');
});

test('zh-Hant always returns the original stored name', () => {
  assert.equal(displayStopTitle('zh-Hant', '札幌時計台'), '札幌時計台');
  assert.equal(displayStopTitle('zh-Hant', UNIQLO), UNIQLO);
  assert.equal(displayStopTitle('zh-Hant', '不存在的站'), '不存在的站');
});

test('a miss falls back to the original name', () => {
  const missing = 'Minn 札幌大通 西14';
  assert.equal(missing in STOP_DISPLAY_NAMES, false);
  assert.equal(displayStopTitle('ja', missing), missing);
  assert.equal(displayStopTitle('en', missing), missing);
});

test('uniqlo札幌三越店 matches only the exact no-space key', () => {
  assert.equal(UNIQLO in STOP_DISPLAY_NAMES, true);
  assert.equal(UNIQLO.includes(' '), false);
  assert.equal('uniqlo 札幌三越店' in STOP_DISPLAY_NAMES, false);
  assert.equal(displayStopTitle('ja', 'uniqlo 札幌三越店'), 'uniqlo 札幌三越店');
  assert.equal(displayStopTitle('en', ` ${UNIQLO}`), ` ${UNIQLO}`);
  assert.equal(displayStopTitle('ja', `${UNIQLO} `), `${UNIQLO} `);
});

test('lookup does not rewrite the stored title', () => {
  const stored = UNIQLO;
  displayStopTitle('ja', stored);
  displayStopTitle('en', stored);
  displayStopTitle('zh-Hant', stored);
  assert.equal(stored, 'uniqlo札幌三越店');
});
