import test from 'node:test';
import assert from 'node:assert/strict';
import { credentialError, isRemovableDemoRow, rowToUser } from '../src/userStore.js';

test('credential checks match the Node server', () => {
  assert.equal(credentialError('', ''), '請輸入帳號與密碼');
  assert.equal(credentialError('a b', 'x'), '帳號不能包含空白');
  assert.equal(credentialError('a', 'é'.repeat(37)), '密碼請勿超過 72 個字元');
  assert.equal(credentialError('yuki', 'pass'), null);
});

test('users.json rows import with their bcrypt hash and id', () => {
  const row = { id: 'u_0123456789abcdef', username: 'Yuki', displayName: 'Yuki', passwordHash: '$2a$10$abc' };
  assert.deepEqual(rowToUser(row), { id: row.id, username: 'yuki', displayName: 'Yuki', passwordHash: '$2a$10$abc' });
  assert.equal(rowToUser({ id: 'x', username: 'y' }), null);
});

test('only non-registered alice/bob rows count as demo rows', () => {
  assert.equal(isRemovableDemoRow({ id: 'u1', username: 'alice' }), true);
  assert.equal(isRemovableDemoRow({ id: 'u_0123456789abcdef', username: 'alice' }), false);
  assert.equal(isRemovableDemoRow({ id: 'u9', username: 'carol' }), false);
});
