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

import { looksLikeAddress, openingHoursNames } from './placeLabel.ts';

const ADDRESS = '日本、〒060-0001 北海道札幌市中央区北１条西２丁目';

test('address-like names are recognised', () => {
  assert.equal(looksLikeAddress('', ADDRESS), true);
  assert.equal(looksLikeAddress(ADDRESS, ADDRESS), true);
  assert.equal(looksLikeAddress('〒060-0001 札幌市', ''), true);
  assert.equal(looksLikeAddress(`札幌市時計台 ${ADDRESS}`, ADDRESS), true);
  assert.equal(looksLikeAddress('札幌市時計台', ADDRESS), false);
});

test('opening-hours lookup falls back to the typed search text when the name is an address', () => {
  assert.deepEqual(
    openingHoursNames({ name: ADDRESS, address: ADDRESS, searchText: ' 札幌市時計台 ', title: '' }),
    ['札幌市時計台'],
  );
  assert.deepEqual(openingHoursNames({ name: '', address: ADDRESS, searchText: '北海道大学', title: '' }), ['北海道大学']);
});

test('a real place name goes first; at most two distinct candidates; never an address', () => {
  assert.deepEqual(
    openingHoursNames({ name: '札幌市時計台', address: ADDRESS, searchText: '時計台', title: '我的集合點' }),
    ['札幌市時計台', '時計台'],
  );
  assert.deepEqual(
    openingHoursNames({ name: ADDRESS, address: ADDRESS, searchText: '時計台', title: '我的集合點' }),
    ['時計台', '我的集合點'],
  );
  assert.deepEqual(openingHoursNames({ name: '時計台', address: '', searchText: ' 時計　台 ', title: '時計台' }), ['時計台']);
});

test('nothing usable means no lookup at all, so the field stays empty', () => {
  assert.deepEqual(openingHoursNames({ name: ADDRESS, address: ADDRESS, searchText: ADDRESS, title: ADDRESS }), []);
  assert.deepEqual(openingHoursNames({ name: '', address: '', searchText: '  ', title: null }), []);
});
