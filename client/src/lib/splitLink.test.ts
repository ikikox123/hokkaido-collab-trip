import test from 'node:test';
import assert from 'node:assert/strict';
import { isSplitPath, splitPageUrl, splitShareText } from './splitLink.ts';

test('the room split link is a stable /split path', () => {
  assert.equal(isSplitPath('/split'), true);
  assert.equal(isSplitPath('/split/'), true);
  assert.equal(isSplitPath('/'), false);
  assert.equal(isSplitPath('/map'), false);
  assert.equal(splitPageUrl('https://trip.example'), 'https://trip.example/split');
  assert.equal(splitPageUrl('https://trip.example/'), 'https://trip.example/split');
});

test('share text is the bare URL plus one Traditional Chinese line', () => {
  const text = splitShareText('https://trip.example');
  const [url, line, extra] = text.split('\n');
  assert.equal(url, 'https://trip.example/split');
  assert.equal(line, '北海道分帳，點開就能看帳、記一筆');
  assert.equal(extra, undefined);
});
