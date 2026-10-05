import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { catalog, text } from '../i18n/messages.ts';
import { shareLocation } from './sharePath.ts';
import {
  SHARE_CAPTURE_TIMEOUT_MS,
  SHARE_CANVAS_EDGE_LIMIT,
  SHARE_CANVAS_PIXEL_BUDGET,
  SHARE_EXPORT_IGNORE_ATTR,
  SHARE_EXPORT_INTENT_KEY,
  canShareImageFile,
  captureSharePng,
  clickSharePdf,
  deliverSharePng,
  inAppBrowserKind,
  includeInShareImage,
  isIosDevice,
  isShareExportKind,
  lineExternalBrowserUrl,
  loadCaptureImage,
  openShareExport,
  openShareImagePreview,
  pngFile,
  printSharePdf,
  rememberShareExport,
  revokeSharePreviewUrls,
  settleShareImageExport,
  shareExportControlState,
  shareExportFilename,
  shareImageCaptureOptions,
  shareImageNoticeKey,
  shareImagePixelRatio,
  shareImagePreviewHtml,
  shareMenuPosition,
  sharePreviewObjectUrls,
  takeShareExport,
  type CaptureImage,
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

test('capture returns one png and clears the capture class', async () => {
  const marks: boolean[] = [];
  const ratios: number[] = [];
  const blob = await captureSharePng({} as HTMLElement, {
    toBlob: async (_node, options) => {
      ratios.push(options.pixelRatio ?? 0);
      assert.equal(options.skipFonts, true);
      assert.equal(options.fontEmbedCSS, '');
      return new Blob(['png'], { type: 'image/png' });
    },
    markCapturing: (active) => marks.push(active),
  });
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(ratios, [2]);
  assert.deepEqual(marks, [true, false]);
});

test('a failed 2x capture retries once at 1x', async () => {
  const ratios: number[] = [];
  const blob = await captureSharePng({} as HTMLElement, {
    toBlob: async (_node, options) => {
      ratios.push(options.pixelRatio ?? 0);
      if (options.pixelRatio === 2) throw new Error('canvas-too-big');
      return new Blob(['png'], { type: 'image/png' });
    },
    markCapturing: () => {},
  });
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(ratios, [2, 1]);
});

function sampleFile() {
  return pngFile(new Blob(['png'], { type: 'image/png' }), 'hokkaido-day-2-zh-Hant.png');
}

test('a shareable file uses the share sheet and does not download', async () => {
  const shared: File[][] = [];
  const downloads: string[] = [];
  const file = sampleFile();
  const outcome = await deliverSharePng(file, {
    ios: false,
    nav: {
      canShare: (data) => data.files?.[0] === file,
      share: async (data) => {
        shared.push(data.files ?? []);
      },
    },
    download: (next) => downloads.push(next.name),
  });
  assert.equal(outcome, 'shared');
  assert.equal(shareImageNoticeKey(outcome), 'shareImageShared');
  assert.deepEqual(shared, [[file]]);
  assert.deepEqual(downloads, []);
});

test('cancelling the share sheet stays quiet', async () => {
  const downloads: string[] = [];
  let previews = 0;
  const outcome = await deliverSharePng(sampleFile(), {
    ios: true,
    userGesture: true,
    nav: {
      canShare: () => true,
      share: async () => {
        const err = new Error('cancelled');
        err.name = 'AbortError';
        throw err;
      },
    },
    download: (next) => downloads.push(next.name),
    openPreview: () => {
      previews += 1;
      return true;
    },
  });
  assert.equal(outcome, 'cancelled');
  assert.equal(shareImageNoticeKey(outcome), null);
  assert.deepEqual(downloads, []);
  assert.equal(previews, 0);
});

test('a blocked share waits for another tap instead of claiming a download', async () => {
  const downloads: string[] = [];
  const outcome = await deliverSharePng(sampleFile(), {
    ios: false,
    nav: {
      canShare: () => true,
      share: async () => {
        const err = new DOMException('gesture', 'NotAllowedError');
        throw err;
      },
    },
    download: (next) => downloads.push(next.name),
    openPreview: () => true,
  });
  assert.equal(outcome, 'needs-gesture');
  assert.equal(shareImageNoticeKey(outcome), null);
  assert.deepEqual(downloads, []);
});

test('desktop without a share sheet downloads the png', async () => {
  const downloads: string[] = [];
  const file = sampleFile();
  const outcome = await deliverSharePng(file, {
    ios: false,
    nav: { canShare: () => false },
    download: (next) => downloads.push(next.name),
  });
  assert.equal(outcome, 'downloaded');
  assert.equal(shareImageNoticeKey(outcome), 'shareImageSaved');
  assert.deepEqual(downloads, [file.name]);
  assert.equal(canShareImageFile(file, null), false);
  assert.equal(canShareImageFile(file, { canShare: () => { throw new Error('nope'); } }), false);
});

test('iOS without a share sheet opens a preview instead of a silent download', async () => {
  const downloads: string[] = [];
  const previews: string[] = [];
  const file = sampleFile();
  const outcome = await deliverSharePng(file, {
    ios: true,
    userGesture: true,
    hint: '長按圖片儲存',
    nav: { canShare: () => false },
    download: (next) => downloads.push(next.name),
    openPreview: (next, hint) => {
      previews.push(`${next.name}:${hint}`);
      return true;
    },
  });
  assert.equal(outcome, 'preview');
  assert.equal(shareImageNoticeKey(outcome), 'shareImageLongPress');
  assert.deepEqual(downloads, []);
  assert.deepEqual(previews, ['hokkaido-day-2-zh-Hant.png:長按圖片儲存']);
});

test('a blocked iOS preview also waits for another tap', async () => {
  const outcome = await deliverSharePng(sampleFile(), {
    ios: true,
    userGesture: true,
    nav: null,
    openPreview: () => false,
    download: () => {
      throw new Error('should-not-download');
    },
  });
  assert.equal(outcome, 'needs-gesture');
  assert.equal(shareImageNoticeKey(outcome), null);
});

test('iOS includes iPadOS desktop mode and skips a normal computer', () => {
  assert.equal(isIosDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)'), true);
  assert.equal(isIosDevice('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)'), true);
  assert.equal(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5), true);
  assert.equal(isIosDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0), false);
  assert.equal(isIosDevice('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'), false);
});

test('the preview page shows the hint and the picture', () => {
  const html = shareImagePreviewHtml('blob:hokkaido', '長按圖片儲存<script>', 'day "2"');
  assert.equal(html.includes('長按圖片儲存'), true);
  assert.equal(html.includes('<script>'), false);
  assert.equal(html.includes('blob:hokkaido'), true);
  assert.equal(html.includes('day &quot;2&quot;'), true);
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

test('image save copy matches the path that actually ran', () => {
  assert.equal(catalog.shareImageSaved['zh-Hant'], '已下載圖片');
  assert.equal(catalog.shareImageShared['zh-Hant'], '已開啟圖片分享');
  assert.equal(catalog.shareImageLongPress['zh-Hant'], '長按圖片儲存');
  assert.equal(catalog.shareImageReady['zh-Hant'], '圖片好了，按這裡儲存／分享');
  assert.notEqual(catalog.shareImageLongPress['zh-Hant'], catalog.shareImageSaved['zh-Hant']);
  assert.notEqual(catalog.shareImageReady['zh-Hant'], catalog.shareImageSaved['zh-Hant']);
  assert.notEqual(catalog.shareImageShared['zh-Hant'], catalog.shareImageSaved['zh-Hant']);
  for (const locale of ['zh-Hant', 'ja', 'en'] as const) {
    assert.ok(catalog.shareImageSaved[locale].length > 0);
    assert.ok(catalog.shareImageShared[locale].length > 0);
    assert.ok(catalog.shareImageLongPress[locale].length > 0);
    assert.ok(catalog.shareImageReady[locale].length > 0);
    assert.notEqual(catalog.shareImageLongPress[locale], catalog.shareImageSaved[locale]);
    assert.notEqual(catalog.shareImageReady[locale], catalog.shareImageSaved[locale]);
  }
  assert.equal(shareImageNoticeKey('downloaded'), 'shareImageSaved');
  assert.equal(shareImageNoticeKey('preview'), 'shareImageLongPress');
  assert.equal(shareImageNoticeKey('needs-gesture'), null);
  assert.equal(shareImageNoticeKey('cancelled'), null);
});

function scriptedImage(behavior: 'reject' | 'hang'): CaptureImage {
  let src = '';
  const img: CaptureImage = {
    get src() {
      return src;
    },
    set src(value: string) {
      src = value;
      queueMicrotask(() => {
        img.onload?.();
      });
    },
    onload: null,
    onerror: null,
    decode: () => (behavior === 'hang' ? new Promise<void>(() => {}) : Promise.reject(new Error('decode-fail'))),
  };
  return img;
}

test('a rejected decode falls back to the loaded image and continues', async () => {
  const image = await loadCaptureImage('data:image/svg+xml,ok', {
    create: () => scriptedImage('reject'),
  });
  assert.equal(image.src, 'data:image/svg+xml,ok');
});

test('a decode that never settles falls back to onload and continues', async () => {
  const started = Date.now();
  const image = await loadCaptureImage('data:image/svg+xml,hang', {
    decodeTimeoutMs: 30,
    create: () => scriptedImage('hang'),
  });
  assert.equal(image.src, 'data:image/svg+xml,hang');
  assert.ok(Date.now() - started < 400);
});

test('decode fails: error hint within the timeout and both buttons return', async () => {
  const during = shareExportControlState(true, true);
  assert.equal(during.imageDisabled, true);
  assert.equal(during.pdfDisabled, false);
  const started = Date.now();
  const result = await settleShareImageExport({
    canExport: true,
    filename: 'hokkaido-day-1-zh-Hant.png',
    ios: false,
    timeoutMs: 400,
    capture: async () => {
      await loadCaptureImage('data:image/svg+xml,bad', {
        create: () => scriptedImage('reject'),
      });
      throw new Error('decode-fail');
    },
  });
  assert.ok(Date.now() - started < 400);
  assert.equal(result.timedOut, false);
  assert.equal(result.noticeKey, 'shareExportFailed');
  assert.equal(text('zh-Hant', result.noticeKey), '無法匯出，請再試一次');
  assert.equal(text('ja', 'shareExportFailed').length > 0, true);
  assert.equal(text('en', 'shareExportFailed').length > 0, true);
  assert.equal(result.imageDisabled, false);
  assert.equal(result.pdfDisabled, false);
  assert.equal(result.ready, false);
  assert.equal(result.file, null);
});

test('decode never responds: error hint within the timeout and both buttons return', async () => {
  const started = Date.now();
  const result = await settleShareImageExport({
    canExport: true,
    filename: 'hokkaido-trip-zh-Hant.png',
    ios: true,
    timeoutMs: 40,
    capture: () =>
      loadCaptureImage('data:image/svg+xml,hang', {
        decodeTimeoutMs: 80,
        create: () => scriptedImage('hang'),
      }).then(() => new Blob(['png'], { type: 'image/png' })),
  });
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 30);
  assert.ok(elapsed < 400);
  assert.equal(result.timedOut, true);
  assert.equal(result.noticeKey, 'shareExportFailed');
  assert.equal(text('zh-Hant', 'shareExportFailed'), '無法匯出，請再試一次');
  assert.equal(result.imageDisabled, false);
  assert.equal(result.pdfDisabled, false);
  assert.equal(result.ready, false);
  assert.equal(result.file, null);
  assert.equal(SHARE_CAPTURE_TIMEOUT_MS, 20_000);
});

test('a capture that never finishes rejects at the timeout and clears the capture class', async () => {
  const marks: boolean[] = [];
  const started = Date.now();
  await assert.rejects(
    () =>
      captureSharePng({} as HTMLElement, {
        timeoutMs: 30,
        toBlob: () => new Promise(() => {}),
        markCapturing: (active) => marks.push(active),
      }),
    (err: Error) => err.message === 'share-export-timeout',
  );
  assert.ok(Date.now() - started < 500);
  assert.deepEqual(marks, [true, false]);
});

test('a desktop-wide full page auto-reduces the pixel ratio', async () => {
  const width = 1280;
  const height = 6000;
  const ratio = shareImagePixelRatio(width, height);
  assert.ok(ratio < 2);
  assert.equal(
    ratio,
    Math.min(
      2,
      Math.sqrt(SHARE_CANVAS_PIXEL_BUDGET / (width * height)),
      SHARE_CANVAS_EDGE_LIMIT / height,
      SHARE_CANVAS_EDGE_LIMIT / width,
    ),
  );
  const ratios: number[] = [];
  await captureSharePng({} as HTMLElement, {
    width,
    height,
    toBlob: async (_node, options) => {
      ratios.push(options.pixelRatio ?? 0);
      return new Blob(['png'], { type: 'image/png' });
    },
    markCapturing: () => {},
  });
  assert.deepEqual(ratios, [ratio]);
});

test('safari runs one empty warm-up before the real capture', async () => {
  let warmups = 0;
  const ratios: number[] = [];
  await captureSharePng({} as HTMLElement, {
    safari: true,
    width: 320,
    height: 480,
    warmup: async () => {
      warmups += 1;
    },
    toBlob: async (_node, options) => {
      ratios.push(options.pixelRatio ?? 0);
      return new Blob(['png'], { type: 'image/png' });
    },
    markCapturing: () => {},
  });
  assert.equal(warmups, 1);
  assert.deepEqual(ratios, [2]);
});

test('iOS capture shows the save button and does not call share', async () => {
  let shares = 0;
  const result = await settleShareImageExport({
    canExport: true,
    filename: 'hokkaido-day-2-zh-Hant.png',
    ios: true,
    capture: async () => new Blob(['png'], { type: 'image/png' }),
    deliver: async () => {
      shares += 1;
      return 'shared';
    },
  });
  assert.equal(shares, 0);
  assert.equal(result.ready, true);
  assert.equal(result.noticeKey, null);
  assert.equal(result.file?.name, 'hokkaido-day-2-zh-Hant.png');
  assert.equal(catalog.shareImageReady['zh-Hant'], '圖片好了，按這裡儲存／分享');
  assert.ok(catalog.shareImageReady.ja.length > 0);
  assert.ok(catalog.shareImageReady.en.length > 0);
});

test('after capture, iOS does not call share until the tap', async () => {
  let shares = 0;
  const outcome = await deliverSharePng(sampleFile(), {
    ios: true,
    userGesture: false,
    nav: {
      canShare: () => true,
      share: async () => {
        shares += 1;
      },
    },
    download: () => {
      throw new Error('no-download');
    },
    openPreview: () => {
      throw new Error('no-preview');
    },
  });
  assert.equal(outcome, 'needs-gesture');
  assert.equal(shares, 0);
});

test('a second blocked share falls back to preview instead of failing quietly', async () => {
  const previews: string[] = [];
  const outcome = await deliverSharePng(sampleFile(), {
    ios: true,
    userGesture: true,
    hint: '長按圖片儲存',
    nav: {
      canShare: () => true,
      share: async () => {
        throw new DOMException('blocked', 'NotAllowedError');
      },
    },
    download: () => {
      throw new Error('should-preview');
    },
    openPreview: (_file, hint) => {
      previews.push(hint);
      return true;
    },
  });
  assert.equal(outcome, 'preview');
  assert.deepEqual(previews, ['長按圖片儲存']);
});

test('a second blocked share on desktop downloads instead of waiting again', async () => {
  const downloads: string[] = [];
  const outcome = await deliverSharePng(sampleFile(), {
    ios: false,
    userGesture: true,
    nav: {
      canShare: () => true,
      share: async () => {
        throw new DOMException('blocked', 'NotAllowedError');
      },
    },
    download: (file) => downloads.push(file.name),
  });
  assert.equal(outcome, 'downloaded');
  assert.deepEqual(downloads, ['hokkaido-day-2-zh-Hant.png']);
});

test('non-iOS download failure opens a preview', async () => {
  const previews: string[] = [];
  const outcome = await deliverSharePng(sampleFile(), {
    ios: false,
    hint: '長按圖片儲存',
    nav: { canShare: () => false },
    download: () => {
      throw new Error('download-failed');
    },
    openPreview: (file, hint) => {
      previews.push(`${file.name}:${hint}`);
      return true;
    },
  });
  assert.equal(outcome, 'preview');
  assert.equal(shareImageNoticeKey(outcome), 'shareImageLongPress');
  assert.deepEqual(previews, ['hokkaido-day-2-zh-Hant.png:長按圖片儲存']);
});

test('cancelling share drops the exporting result and the save button', async () => {
  const result = await settleShareImageExport({
    canExport: true,
    filename: 'hokkaido-day-2-zh-Hant.png',
    ios: false,
    capture: async () => new Blob(['png'], { type: 'image/png' }),
    deliver: async () => 'cancelled',
  });
  assert.equal(result.noticeKey, null);
  assert.equal(result.ready, false);
  assert.equal(result.file, null);
  assert.equal(result.imageDisabled, false);
  assert.equal(result.pdfDisabled, false);
});

test('a closed preview revokes its blob url', () => {
  const revoked: string[] = [];
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  let n = 0;
  URL.createObjectURL = (() => {
    n += 1;
    return `blob:preview-${n}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = ((url: string) => {
    revoked.push(url);
  }) as typeof URL.revokeObjectURL;
  try {
    const listeners: Record<string, () => void> = {};
    const opened = openShareImagePreview(sampleFile(), '長按', () => ({
      document: {
        open() {},
        write() {},
        close() {},
      },
      addEventListener(type: string, fn: () => void) {
        listeners[type] = fn;
      },
    }));
    assert.equal(opened, true);
    assert.deepEqual(sharePreviewObjectUrls(), ['blob:preview-1']);
    listeners.pagehide?.();
    assert.deepEqual(sharePreviewObjectUrls(), []);
    assert.deepEqual(revoked, ['blob:preview-1']);

    const blocked = openShareImagePreview(sampleFile(), '長按', () => null);
    assert.equal(blocked, false);
    assert.deepEqual(revoked, ['blob:preview-1', 'blob:preview-2']);
    assert.deepEqual(sharePreviewObjectUrls(), []);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    revokeSharePreviewUrls();
  }
});

const shareCaptureCss = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');

/** True when the capture stylesheet forces this node to display:none. */
function hiddenByShareCapture(classes: string[], insideExportRoot: boolean) {
  const globalHide = /html\.share-capturing \.print\\:hidden\s*\{[^}]*display:\s*none\s*!important/.test(shareCaptureCss);
  const scopedHide =
    /html\.share-capturing \[data-share-export-root\] \.print\\:hidden\s*\{[^}]*display:\s*none\s*!important/.test(
      shareCaptureCss,
    );
  if (!classes.includes('print:hidden')) return false;
  if (globalHide) return true;
  return scopedHide && insideExportRoot;
}

test('during capture the action bar and notices stay visible', () => {
  assert.match(
    shareCaptureCss,
    /html\.share-capturing \[data-share-export-root\] \.print\\:hidden \{\s*display: none !important;\s*\}/,
  );
  assert.equal(/html\.share-capturing \.print\\:hidden \{/.test(shareCaptureCss), false);

  const actionBar = ['share-actionbar', 'share-export-ignore', 'print:hidden', 'md:hidden'];
  const notice = ['share-export-ignore', 'print:hidden'];
  const saveButton = ['share-export-ignore', 'print:hidden'];
  assert.equal(hiddenByShareCapture(actionBar, false), false);
  assert.equal(hiddenByShareCapture(notice, false), false);
  assert.equal(hiddenByShareCapture(saveButton, false), false);
  assert.equal(hiddenByShareCapture(['print:hidden'], true), true);

  assert.equal(
    includeInShareImage({
      hasAttribute: (name: string) => name === 'data-share-export-ignore',
      classList: { contains: (name: string) => actionBar.includes(name) },
    }),
    false,
  );
  assert.equal(
    includeInShareImage({
      hasAttribute: () => false,
      classList: { contains: (name: string) => notice.includes(name) },
    }),
    false,
  );
});

test('during capture, tapping PDF synchronously calls print', () => {
  const controls = shareExportControlState(true, true);
  assert.equal(controls.imageDisabled, true);
  assert.equal(controls.pdfDisabled, false);
  let printed = 0;
  let sawMicrotask = false;
  queueMicrotask(() => {
    sawMicrotask = true;
  });
  const ran = clickSharePdf({ canExport: true, capturing: true }, () => {
    printed += 1;
    assert.equal(sawMicrotask, false);
  });
  assert.equal(ran, true);
  assert.equal(printed, 1);
  assert.equal(clickSharePdf({ canExport: false, capturing: true }, () => {
    printed += 1;
  }), false);
  assert.equal(printed, 1);
});

test('in-app browsers ask for Safari, and LINE can open the same page outside', () => {
  assert.equal(inAppBrowserKind('Mozilla/5.0 Line/14.0.0'), 'line');
  assert.equal(inAppBrowserKind('FBAN/FBIOS'), 'facebook');
  assert.equal(inAppBrowserKind('FBAV/1'), 'facebook');
  assert.equal(inAppBrowserKind('Instagram 123'), 'instagram');
  assert.equal(inAppBrowserKind('MicroMessenger/8'), 'wechat');
  assert.equal(inAppBrowserKind('Mozilla/5.0 (iPhone) Safari/605'), null);
  assert.equal(catalog.openInSafari['zh-Hant'], '請用 Safari 開啟');
  assert.ok(catalog.openInSafari.ja.length > 0);
  assert.ok(catalog.openInSafari.en.length > 0);
  const href = lineExternalBrowserUrl('https://hokkaido.example/share?day=2&lang=ja');
  assert.equal(href, 'https://hokkaido.example/share?day=2&lang=ja&openExternalBrowser=1');
  assert.equal(href.includes('token'), false);
  assert.equal(catalog.shareCanExport['zh-Hant'], '也可匯出圖片或 PDF。');
  assert.notEqual(catalog.shareCanExport.ja, catalog.shareCanExport.en);
});
