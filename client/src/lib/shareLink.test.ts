import test from 'node:test';
import assert from 'node:assert/strict';
import { shareOrCopy, sharePageUrl, type ShareNavigator } from './shareLink.ts';

test('share url is day and lang on /share, with no credentials', () => {
  const url = sharePageUrl('https://hokkaido.example/', { kind: 'day', day: 2 }, 'ja');
  assert.equal(url, 'https://hokkaido.example/share?day=2&lang=ja');
  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/share');
  assert.deepEqual([...parsed.searchParams.keys()], ['day', 'lang']);
  assert.equal(parsed.username, '');
  assert.equal(parsed.password, '');
  assert.equal(parsed.hash, '');
  assert.equal(url.includes('token'), false);
});

test('shareOrCopy uses the share sheet, then the clipboard', async () => {
  const shared: { url?: string; text?: string }[] = [];
  const sheet: ShareNavigator = {
    share: async (data) => {
      shared.push(data ?? {});
    },
  };
  assert.equal(await shareOrCopy('https://hokkaido.example/share?lang=en', sheet), 'shared');
  assert.equal(shared[0]?.url, 'https://hokkaido.example/share?lang=en');
  assert.equal(shared[0]?.text, undefined);

  const writes: string[] = [];
  const clipboard: ShareNavigator = {
    clipboard: {
      writeText: async (value) => {
        writes.push(value);
      },
    },
  };
  assert.equal(await shareOrCopy('https://hokkaido.example/share?day=1&lang=zh-Hant', clipboard), 'copied');
  assert.deepEqual(writes, ['https://hokkaido.example/share?day=1&lang=zh-Hant']);
});

test('a cancelled share sheet does not copy', async () => {
  const writes: string[] = [];
  const nav: ShareNavigator = {
    share: async () => {
      const err = new Error('cancelled');
      err.name = 'AbortError';
      throw err;
    },
    clipboard: {
      writeText: async (value) => {
        writes.push(value);
      },
    },
  };
  await assert.rejects(() => shareOrCopy('https://hokkaido.example/share?lang=ja', nav), { name: 'AbortError' });
  assert.deepEqual(writes, []);
});
