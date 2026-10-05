import test from 'node:test';
import assert from 'node:assert/strict';
import { stopMarkerHtml, stopMarkerIconUrl } from './stopMarker.ts';

function svgFor(kind: 'selected' | 'next' | 'normal', number: number): string {
  const { url } = stopMarkerIconUrl(kind, number);
  const encoded = url.slice(url.indexOf(',') + 1);
  return decodeURIComponent(encoded);
}

test('marker graphics draw the stop number on highlighted and normal dots', () => {
  const selected = svgFor('selected', 4);
  assert.match(selected, />4</);
  assert.match(selected, /fill="#2563a8"/);
  assert.match(selected, /fill="#ffffff"/);

  const next = svgFor('next', 1);
  assert.match(next, />1</);
  assert.match(next, /fill="#ec4899"/);

  const normal = stopMarkerHtml('normal', 12);
  assert.match(normal.html, />12</);
  assert.match(normal.html, /#64748b/);
  assert.equal(normal.size >= 34, true);

  const wide = svgFor('normal', 10);
  assert.match(wide, />10</);
});
