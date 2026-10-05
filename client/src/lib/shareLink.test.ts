import test from 'node:test';
import assert from 'node:assert/strict';
import { shareOrCopy, sharePageUrl } from './shareLink.ts';

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
  const shared: ShareData[] = [];
  const previousShare = navigator.share;
  navigator.share = async (data) => {
    shared.push(data ?? {});
  };
  try {
    assert.equal(await shareOrCopy('https://hokkaido.example/share?lang=en'), 'shared');
    assert.equal(shared[0]?.url, 'https://hokkaido.example/share?lang=en');
    assert.equal(shared[0]?.text, undefined);
  } finally {
    if (previousShare) navigator.share = previousShare;
    else delete navigator.share;
  }

  const writes: string[] = [];
  const previousClipboard = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: async (value: string) => {
        writes.push(value);
      },
    },
  });
  try {
    assert.equal(await shareOrCopy('https://hokkaido.example/share?day=1&lang=zh-Hant'), 'copied');
    assert.deepEqual(writes, ['https://hokkaido.example/share?day=1&lang=zh-Hant']);
  } finally {
    if (previousClipboard) {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: previousClipboard });
    }
  }
});

test('a cancelled share sheet does not copy', async () => {
  const previousShare = navigator.share;
  navigator.share = async () => {
    const err = new Error('cancelled');
    err.name = 'AbortError';
    throw err;
  };
  const writes: string[] = [];
  const previousClipboard = navigator.clipboard;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (value: string) => writes.push(value) },
  });
  try {
    await assert.rejects(() => shareOrCopy('https://hokkaido.example/share?lang=ja'), { name: 'AbortError' });
    assert.deepEqual(writes, []);
  } finally {
    if (previousShare) navigator.share = previousShare;
    else delete navigator.share;
    if (previousClipboard) {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: previousClipboard });
    }
  }
});
