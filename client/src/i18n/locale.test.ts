import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog, text } from './messages.ts';
import { knownErrorMatchesCatalog, localizeError } from './errors.ts';
import { readLocale } from './storage.ts';

test('Japanese and English cover every Traditional Chinese string', () => {
  for (const key of Object.keys(catalog) as (keyof typeof catalog)[]) {
    assert.equal(typeof catalog[key].ja, 'string');
    assert.equal(typeof catalog[key].en, 'string');
    assert.ok(catalog[key].ja.length > 0);
    assert.ok(catalog[key].en.length > 0);
  }
});

test('default language is Traditional Chinese and unknown values are ignored', () => {
  assert.equal(readLocale({ getItem: () => null }), 'zh-Hant');
  assert.equal(readLocale({ getItem: () => 'en' }), 'en');
  assert.equal(readLocale({ getItem: () => 'ja' }), 'ja');
  assert.equal(readLocale({ getItem: () => 'zh-Hant' }), 'zh-Hant');
  assert.equal(readLocale({ getItem: () => 'fr' }), 'zh-Hant');
  assert.equal(readLocale(null), 'zh-Hant');
  assert.equal(
    readLocale({
      getItem() {
        throw new Error('storage blocked');
      },
    }),
    'zh-Hant',
  );
});

test('known interface errors follow the language and saved trip text does not', () => {
  assert.equal(knownErrorMatchesCatalog(), true);
  const translate = (key: keyof typeof catalog) => text('en', key);
  assert.equal(localizeError('請先登入才能編輯', translate), 'Log in to edit');
  assert.equal(localizeError('帳號或密碼錯誤', translate), 'Wrong username or password');
  assert.equal(localizeError('這個帳號名稱不能使用', translate), 'This account name cannot be used');
  assert.equal(text('ja', 'usernameReserved'), 'このアカウント名は使えません');
  assert.equal(localizeError('小樽運河', translate), '小樽運河');
  assert.equal(localizeError('Alice', translate), 'Alice');
  assert.equal(text('zh-Hant', 'tabSplit'), '分帳');
  assert.equal(text('ja', 'welcome', { name: 'Alice' }), 'ようこそ、Alice');
});
