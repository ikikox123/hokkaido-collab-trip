import test from 'node:test';
import assert from 'node:assert/strict';
import { selectionFromPlace } from './placeLabel.ts';

test('landmark name stays the title and the search field gets the address', () => {
  const picked = selectionFromPlace({
    name: '札幌市時計台',
    formattedAddress: '日本、〒060-0042 北海道札幌市中央区大通西２丁目',
  });
  assert.equal(picked.title, '札幌市時計台');
  assert.equal(picked.search, '日本、〒060-0042 北海道札幌市中央区大通西２丁目');
  assert.equal(picked.address, picked.search);
  assert.notEqual(picked.title, picked.search);
});

test('a suggestion description that includes the address is split', () => {
  const address = '日本、〒060-0042 北海道札幌市中央区大通西２丁目';
  const picked = selectionFromPlace({
    name: `札幌市時計台, ${address}`,
    formattedAddress: address,
  });
  assert.equal(picked.title, '札幌市時計台');
  assert.equal(picked.search, address);
});

test('an address-only result can use the address as the title', () => {
  const address = '日本、〒060-0001 北海道札幌市中央区北１条西２丁目';
  const picked = selectionFromPlace({ name: address, formattedAddress: address });
  assert.equal(picked.title, address);
  assert.equal(picked.search, address);
});

test('missing name falls back without inventing a second copy of nothing', () => {
  const picked = selectionFromPlace({ name: '  ', formattedAddress: '  大通公園  ' });
  assert.equal(picked.title, '大通公園');
  assert.equal(picked.search, '大通公園');
});
