import test from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../i18n/messages.ts';
import { shareLocation } from './sharePath.ts';
import {
  SHARE_EXPORT_IGNORE_ATTR,
  SHARE_EXPORT_INTENT_KEY,
  captureSharePng,
  includeInShareImage,
  isShareExportKind,
  openShareExport,
  printSharePdf,
  rememberShareExport,
  shareExportFilename,
  shareImageCaptureOptions,
  shareMenuPosition,
  takeShareExport,
  type ExportStorage,
} from './shareExport.ts';

function memoryStorage(): ExportStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

test('export filenames follow the day and language, with no credentials', () => {
  assert.equal(shareExportFilename({ kind: 'day', day: 2 }, 'ja'), 'hokkaido-day-2-ja.png');
  assert.equal(shareExportFilename({ kind: 'day', day: 7 }, 'zh-Hant'), 'hokkaido-day-7-zh-Hant.png');
  assert.equal(shareExportFilename({ kind: 'all' }, 'en'), 'hokkaido-trip-en.png');
  assert.equal(shareExportFilename({ kind: 'day', day: 0 }, 'zh-Hant'), 'hokkaido-trip-zh-Hant.png');
  const name = shareExportFilename({ kind: 'day', day: 3 }, 'en');
  assert.equal(name.includes('token'), false);
  assert.equal(name.includes('password'), false);
});

test('image capture does not request remote fonts or cache-bust urls', () => {
  const options = shareImageCaptureOptions();
  assert.equal(options.skipFonts, true);
  assert.equal(options.fontEmbedCSS, '');
  assert.equal(options.cacheBust, false);
  assert.equal(options.pixelRatio, 2);
  assert.equal(options.backgroundColor, '#f5f9fc');
  assert.equal(JSON.stringify({ ...options, filter: undefined }).includes('http'), false);
  assert.equal(options.filter?.({ hasAttribute: () => false } as HTMLElement), true);
});

test('toolbar nodes stay out of the picture and text nodes stay in', () => {
  assert.equal(includeInShareImage(null), true);
  assert.equal(includeInShareImage({ nodeType: 3 }), true);
  assert.equal(
    includeInShareImage({
      hasAttribute: (name: string) => name === SHARE_EXPORT_IGNORE_ATTR,
      classList: { contains: () => false },
    }),
    false,
  );
  assert.equal(
    includeInShareImage({
      hasAttribute: () => false,
      classList: { contains: (name: string) => name === 'share-export-ignore' },
    }),
    false,
  );
  assert.equal(
    includeInShareImage({
      hasAttribute: () => false,
      classList: { contains: (name: string) => name === 'print:hidden' },
    }),
    false,
  );
  assert.equal(
    includeInShareImage({
      hasAttribute: () => false,
      classList: { contains: () => false },
    }),
    true,
  );
});

test('export handoff keeps the share query to day and lang', () => {
  const storage = memoryStorage();
  const urls: string[] = [];
  const events: string[] = [];
  const scope = { kind: 'day' as const, day: 3 };
  const href = openShareExport(
    'image',
    scope,
    'en',
    storage,
    {
      pushState(_data, _unused, url) {
        urls.push(String(url));
      },
    },
    (event) => events.push(event.type),
  );
  assert.equal(href, shareLocation(scope, 'en'));
  assert.equal(href, '/share?day=3&lang=en');
  assert.deepEqual(urls, ['/share?day=3&lang=en']);
  assert.deepEqual(events, ['popstate']);
  assert.equal(href.includes('token'), false);
  assert.equal(href.includes('export'), false);
  assert.equal(href.includes('pdf'), false);
  assert.equal(storage.getItem(SHARE_EXPORT_INTENT_KEY), 'image');
  assert.equal(takeShareExport(storage), 'image');
  assert.equal(takeShareExport(storage), null);
});

test('whole-trip pdf handoff does not add a day', () => {
  const storage = memoryStorage();
  const href = openShareExport('pdf', { kind: 'all' }, 'zh-Hant', storage, { pushState() {} }, () => {});
  assert.equal(href, '/share?lang=zh-Hant');
  assert.equal(takeShareExport(storage), 'pdf');
  assert.equal(isShareExportKind('image'), true);
  assert.equal(isShareExportKind('print'), false);
});

test('unknown export intents are discarded', () => {
  const storage = memoryStorage();
  storage.setItem(SHARE_EXPORT_INTENT_KEY, 'token');
  assert.equal(takeShareExport(storage), null);
  assert.equal(storage.getItem(SHARE_EXPORT_INTENT_KEY), null);
  rememberShareExport('pdf', storage);
  assert.equal(storage.getItem(SHARE_EXPORT_INTENT_KEY), 'pdf');
});

test('the share panel stays inside the viewport', () => {
  const wide = shareMenuPosition({ left: 900, right: 960, bottom: 52 }, 1280);
  assert.equal(wide.width, 240);
  assert.equal(wide.left, 900);
  assert.equal(wide.top, 58);

  const edge = shareMenuPosition({ left: 1100, right: 1160, bottom: 52 }, 1280);
  assert.equal(edge.left, 1032);
  assert.ok(edge.left + edge.width <= 1280 - 8);

  const mobile = shareMenuPosition({ left: 115, right: 163, bottom: 52 }, 390);
  assert.equal(mobile.left, 115);
  assert.ok(mobile.left + mobile.width <= 390 - 8);

  const cramped = shareMenuPosition({ left: 8, right: 60, bottom: 48 }, 200);
  assert.ok(cramped.left >= 8);
  assert.ok(cramped.left + cramped.width <= 200 - 8);
});

test('capture saves one png and clears the capture class', async () => {
  const saved: string[] = [];
  const marks: boolean[] = [];
  const ratios: number[] = [];
  await captureSharePng({} as HTMLElement, 'hokkaido-day-2-ja.png', {
    toBlob: async (_node, options) => {
      ratios.push(options.pixelRatio ?? 0);
      assert.equal(options.skipFonts, true);
      assert.equal(options.fontEmbedCSS, '');
      return new Blob(['png'], { type: 'image/png' });
    },
    save: (_blob, filename) => saved.push(filename),
    markCapturing: (active) => marks.push(active),
  });
  assert.deepEqual(ratios, [2]);
  assert.deepEqual(saved, ['hokkaido-day-2-ja.png']);
  assert.deepEqual(marks, [true, false]);
});

test('a failed 2x capture retries once at 1x', async () => {
  const ratios: number[] = [];
  let saved = '';
  await captureSharePng({} as HTMLElement, 'hokkaido-trip-en.png', {
    toBlob: async (_node, options) => {
      ratios.push(options.pixelRatio ?? 0);
      if (options.pixelRatio === 2) throw new Error('canvas-too-big');
      return new Blob(['png'], { type: 'image/png' });
    },
    save: (_blob, filename) => {
      saved = filename;
    },
    markCapturing: () => {},
  });
  assert.deepEqual(ratios, [2, 1]);
  assert.equal(saved, 'hokkaido-trip-en.png');
});

test('pdf export calls print and does not build an image', () => {
  let printed = 0;
  printSharePdf(() => {
    printed += 1;
  });
  assert.equal(printed, 1);
});

test('share actions are labeled in Traditional Chinese', () => {
  assert.equal(catalog.share['zh-Hant'], '分享');
  assert.equal(catalog.copyLink['zh-Hant'], '複製連結');
  assert.equal(catalog.shareOpenPage['zh-Hant'], '開啟分享頁');
  assert.equal(catalog.shareExportImage['zh-Hant'], '匯出圖片');
  assert.equal(catalog.shareExportPdf['zh-Hant'], '匯出 PDF');
  for (const key of ['share', 'shareActions', 'shareOpenPage', 'shareExportImage', 'shareExportPdf', 'shareImageSaved'] as const) {
    assert.ok(catalog[key].ja.length > 0);
    assert.ok(catalog[key].en.length > 0);
  }
});
