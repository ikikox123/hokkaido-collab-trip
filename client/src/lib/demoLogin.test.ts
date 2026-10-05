import test from 'node:test';
import assert from 'node:assert/strict';
import { demoLoginFields } from './demoLogin.ts';
import { text } from '../i18n/messages.ts';

test('production login hides demo credentials and dev keeps the prefill', () => {
  assert.deepEqual(demoLoginFields(true), { username: '', password: '', showDemoCredentials: false });
  assert.deepEqual(demoLoginFields(false), {
    username: 'alice',
    password: 'demo1234',
    showDemoCredentials: true,
  });
});

test('the non-companion gate is written in Traditional Chinese, Japanese, and English', () => {
  assert.match(text('zh-Hant', 'notCompanionYet'), /旅伴/);
  assert.match(text('zh-Hant', 'notCompanionYet'), /帳號/);
  assert.match(text('ja', 'notCompanionYet'), /アカウント名/);
  assert.match(text('en', 'notCompanionYet'), /account name/);
  assert.equal(text('zh-Hant', 'shareOpen'), '看行程表');
  assert.equal(text('zh-Hant', 'logOut'), '登出');
  assert.notEqual(text('ja', 'notCompanionYet'), text('en', 'notCompanionYet'));
  assert.notEqual(text('zh-Hant', 'loginAccountHint'), text('en', 'loginAccountHint'));
});
