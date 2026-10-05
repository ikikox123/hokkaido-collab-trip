import { shareLocation, type ShareLang, type ShareScope } from './sharePath.ts';

/** Session flag only. Never added to the share URL. */
export const SHARE_EXPORT_INTENT_KEY = 'hokkaido.shareExport';

export const SHARE_EXPORT_IGNORE_ATTR = 'data-share-export-ignore';

export const SHARE_CAPTURE_CLASS = 'share-capturing';

export type ShareExportKind = 'image' | 'pdf';

export type ExportStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

export type ShareHistory = {
  pushState: (data: unknown, unused: string, url?: string | URL | null) => void;
};

export function isShareExportKind(value: string | null): value is ShareExportKind {
  return value === 'image' || value === 'pdf';
}

function browserStorage(): ExportStorage | null {
  try {
    const host = globalThis as { sessionStorage?: ExportStorage };
    return host.sessionStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberShareExport(kind: ShareExportKind, storage: ExportStorage | null = browserStorage()) {
  storage?.setItem(SHARE_EXPORT_INTENT_KEY, kind);
}

/** Read and clear. Anything other than image or pdf is dropped. */
export function takeShareExport(storage: ExportStorage | null = browserStorage()): ShareExportKind | null {
  if (!storage) return null;
  const raw = storage.getItem(SHARE_EXPORT_INTENT_KEY);
  storage.removeItem(SHARE_EXPORT_INTENT_KEY);
  return isShareExportKind(raw) ? raw : null;
}

/** Whole trip, or one day. Language is the display locale already on the share URL. */
export function shareExportFilename(scope: ShareScope, lang: ShareLang) {
  const day = scope.kind === 'day' && Number.isInteger(scope.day) && scope.day > 0 ? `day-${scope.day}` : 'trip';
  return `hokkaido-${day}-${lang}.png`;
}

/**
 * html-to-image calls this for every child, including text.
 * Text stays. Toolbar nodes (attribute or class) leave the picture.
 */
export function includeInShareImage(node: object | null): boolean {
  if (!node || typeof node !== 'object') return true;
  const el = node as {
    hasAttribute?: (name: string) => boolean;
    classList?: { contains: (name: string) => boolean };
  };
  if (typeof el.hasAttribute !== 'function') return true;
  if (el.hasAttribute(SHARE_EXPORT_IGNORE_ATTR)) return false;
  if (el.classList?.contains('share-export-ignore')) return false;
  if (el.classList?.contains('print:hidden')) return false;
  return true;
}

export type ShareImageOptions = {
  cacheBust: false;
  skipFonts: true;
  fontEmbedCSS: '';
  pixelRatio: number;
  backgroundColor: string;
  filter: (domNode: HTMLElement) => boolean;
};

/** No remote font files. `fontEmbedCSS: ''` skips the stylesheet fetch inside html-to-image. */
export function shareImageCaptureOptions(pixelRatio = 2): ShareImageOptions {
  return {
    cacheBust: false,
    skipFonts: true,
    fontEmbedCSS: '',
    pixelRatio,
    backgroundColor: '#f5f9fc',
    filter: (domNode: HTMLElement) => includeInShareImage(domNode),
  };
}

/** Whole screenshot, including Safari warm-up, must finish inside this window. */
export const SHARE_CAPTURE_TIMEOUT_MS = 20_000;

/** Canvas pixel budget and the per-edge limit used by mobile Safari. */
export const SHARE_CANVAS_PIXEL_BUDGET = 16_000_000;
export const SHARE_CANVAS_EDGE_LIMIT = 16_384;

/**
 * A hung `img.decode()` falls back to the load event after this long
 * so the capture can continue instead of waiting out the 20s budget.
 */
export const SHARE_DECODE_FALLBACK_MS = 1_500;

/**
 * Highest scale that stays inside 2×, the pixel budget, and the 16384 edge.
 * A desktop-wide full sheet drops below 2 on its own.
 */
export function shareImagePixelRatio(width: number, height: number) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const ratio = Math.min(
    2,
    Math.sqrt(SHARE_CANVAS_PIXEL_BUDGET / (w * h)),
    SHARE_CANVAS_EDGE_LIMIT / h,
    SHARE_CANVAS_EDGE_LIMIT / w,
  );
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function shareExportControlState(canExport: boolean, busy: boolean) {
  return {
    imageDisabled: !canExport || busy,
    pdfDisabled: !canExport,
  };
}

export type InAppBrowserKind = 'line' | 'facebook' | 'instagram' | 'wechat';

/** In-app webviews where file share and print are unreliable. */
export function inAppBrowserKind(ua: string): InAppBrowserKind | null {
  if (ua.includes('Line/')) return 'line';
  if (ua.includes('FBAN') || ua.includes('FBAV')) return 'facebook';
  if (ua.includes('Instagram')) return 'instagram';
  if (ua.includes('MicroMessenger')) return 'wechat';
  return null;
}

/** LINE opens the same page in the external browser when this flag is present. */
export function lineExternalBrowserUrl(href: string) {
  const url = new URL(href);
  url.searchParams.set('openExternalBrowser', '1');
  return url.toString();
}

export function needsSafariWarmup(ua: string, maxTouchPoints = 0) {
  if (isIosDevice(ua, maxTouchPoints)) return true;
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|EdgiOS|Edg\/|Android|OPiOS/i.test(ua);
}

export function shareMenuPosition(
  rect: { left: number; right: number; bottom: number },
  viewportWidth: number,
): { top: number; left: number; width: number } {
  const width = Math.min(240, Math.max(160, viewportWidth - 16));
  const maxLeft = Math.max(8, viewportWidth - width - 8);
  const left = Math.min(Math.max(8, rect.left), maxLeft);
  return { top: rect.bottom + 6, left, width };
}

/**
 * Open the read-only sheet for this day and language.
 * The export kind stays in sessionStorage so the URL remains `day` and `lang` only.
 */
export function openShareExport(
  kind: ShareExportKind,
  scope: ShareScope,
  lang: ShareLang,
  storage: ExportStorage | null = browserStorage(),
  history: ShareHistory = window.history,
  dispatch: (event: Event) => void = (event) => {
    window.dispatchEvent(event);
  },
) {
  rememberShareExport(kind, storage);
  const href = shareLocation(scope, lang);
  history.pushState({ view: 'share' }, '', href);
  dispatch(new Event('popstate'));
  return href;
}

export function printSharePdf(print: () => void = () => window.print()) {
  print();
}

/**
 * PDF click while an image capture is running.
 * `capturing` does not block the call: `print()` runs in this turn, on the tap.
 */
export function clickSharePdf(
  state: { canExport: boolean; capturing: boolean },
  print: () => void = () => window.print(),
) {
  if (!state.canExport) return false;
  print();
  return true;
}

type ShareRaster = (node: HTMLElement, options: ShareImageOptions) => Promise<Blob | null>;

function defaultMarkCapturing(active: boolean) {
  document.documentElement.classList.toggle(SHARE_CAPTURE_CLASS, active);
}

export type ShareImageOutcome = 'shared' | 'cancelled' | 'downloaded' | 'preview' | 'needs-gesture';

export type ShareFileTarget = {
  canShare?: (data: { files?: File[] }) => boolean;
  share?: (data: { files?: File[] }) => Promise<void>;
};

export function isAbortError(err: unknown) {
  return (err instanceof DOMException || err instanceof Error) && err.name === 'AbortError';
}

/** The user activation expired, so share or a new tab has to wait for another tap. */
export function isGestureBlocked(err: unknown) {
  if (!(err instanceof DOMException) && !(err instanceof Error)) return false;
  return err.name === 'NotAllowedError' || err.name === 'SecurityError';
}

/** iPhone, iPad, iPod, and iPadOS pretending to be a desktop Mac. */
export function isIosDevice(ua: string, maxTouchPoints = 0) {
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}

export function pngFile(blob: Blob, filename: string) {
  return new File([blob], filename, { type: 'image/png' });
}

export function canShareImageFile(file: File, nav: ShareFileTarget | null) {
  if (!nav || typeof nav.canShare !== 'function') return false;
  try {
    return nav.canShare({ files: [file] }) === true;
  } catch {
    return false;
  }
}

/** Only the path that actually ran. A cancelled share or a waiting button says nothing about a download. */
export function shareImageNoticeKey(
  outcome: ShareImageOutcome,
): 'shareImageSaved' | 'shareImageShared' | 'shareImageLongPress' | null {
  if (outcome === 'downloaded') return 'shareImageSaved';
  if (outcome === 'shared') return 'shareImageShared';
  if (outcome === 'preview') return 'shareImageLongPress';
  return null;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (ch) => {
    if (ch === '&') return '&amp;';
    if (ch === '<') return '&lt;';
    if (ch === '>') return '&gt;';
    if (ch === '"') return '&quot;';
    return '&#39;';
  });
}

/** New tab: the hint sits above the picture so a long-press has something to save. */
export function shareImagePreviewHtml(imageUrl: string, hint: string, title: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>body{margin:0;background:#111;color:#fff;font:16px/1.45 -apple-system,sans-serif}p{margin:0;padding:16px;text-align:center}img{display:block;width:100%;height:auto}</style></head><body><p>${escapeHtml(hint)}</p><img alt="${escapeHtml(title)}" src="${escapeHtml(imageUrl)}"></body></html>`;
}

export function downloadShareFile(file: File) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

type PreviewDocument = { open: () => void; write: (html: string) => void; close: () => void };

type PreviewWindow = {
  document: PreviewDocument;
  closed?: boolean;
  addEventListener?: (type: string, listener: () => void) => void;
};

const previewObjectUrls = new Set<string>();

export function sharePreviewObjectUrls() {
  return [...previewObjectUrls];
}

export function revokeSharePreviewUrls(revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {
  for (const url of [...previewObjectUrls]) {
    previewObjectUrls.delete(url);
    try {
      revoke(url);
    } catch {
      /* already revoked */
    }
  }
}

function retainPreviewObjectUrl(url: string, popup: object) {
  previewObjectUrls.add(url);
  const release = () => {
    if (!previewObjectUrls.delete(url)) return;
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  };
  const view = popup as PreviewWindow;
  try {
    view.addEventListener?.('pagehide', release);
  } catch {
    /* test doubles may not implement events */
  }
  if (typeof window !== 'undefined' && typeof view.closed === 'boolean') {
    const timer = window.setInterval(() => {
      if (view.closed || !previewObjectUrls.has(url)) {
        window.clearInterval(timer);
        release();
      }
    }, 1000);
  }
}

export function openShareImagePreview(
  file: File,
  hint: string,
  openImpl: (url?: string | URL, target?: string) => PreviewWindow | null = (url, target) =>
    window.open(url, target),
) {
  const imageUrl = URL.createObjectURL(file);
  let popup: PreviewWindow | null = null;
  try {
    popup = openImpl('', '_blank');
  } catch {
    popup = null;
  }
  if (!popup) {
    URL.revokeObjectURL(imageUrl);
    return false;
  }
  try {
    popup.document.open();
    popup.document.write(shareImagePreviewHtml(imageUrl, hint, file.name));
    popup.document.close();
  } catch {
    URL.revokeObjectURL(imageUrl);
    return false;
  }
  retainPreviewObjectUrl(imageUrl, popup);
  return true;
}

export type CaptureImage = {
  src: string;
  onload: null | (() => void);
  onerror: null | (() => void);
  decode?: () => Promise<void>;
  crossOrigin?: string;
  decoding?: string;
};

function createBrowserImage(): CaptureImage {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.decoding = 'async';
  return img as unknown as CaptureImage;
}

/**
 * Replacement for html-to-image `createImage`.
 * A rejected decode falls back to the load event and continues.
 * A decode that never settles continues after `decodeTimeoutMs`
 * when the load event already fired. The outer 20s budget still applies
 * when the load itself never finishes.
 */
export function loadCaptureImage(
  url: string,
  hooks: {
    create?: () => CaptureImage;
    decodeTimeoutMs?: number;
  } = {},
): Promise<CaptureImage> {
  const img = hooks.create ? hooks.create() : createBrowserImage();
  const decodeTimeoutMs = hooks.decodeTimeoutMs ?? SHARE_DECODE_FALLBACK_MS;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(img);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error('export-image-failed'));
    };
    img.onload = () => {
      const decode = typeof img.decode === 'function' ? img.decode.bind(img) : null;
      if (!decode) {
        finish();
        return;
      }
      let decodeSettled = false;
      const timer = setTimeout(() => {
        if (decodeSettled) return;
        decodeSettled = true;
        finish();
      }, decodeTimeoutMs);
      decode()
        .then(() => {
          if (decodeSettled) return;
          decodeSettled = true;
          clearTimeout(timer);
          finish();
        })
        .catch(() => {
          if (decodeSettled) return;
          decodeSettled = true;
          clearTimeout(timer);
          finish();
        });
    };
    img.onerror = () => fail(new Error('export-image-failed'));
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = url;
  });
}

export async function runTimedShareCapture<T>(
  task: () => Promise<T>,
  timeoutMs = SHARE_CAPTURE_TIMEOUT_MS,
): Promise<{ ok: true; value: T } | { ok: false; reason: 'timeout' | 'failed' }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('share-export-timeout')), timeoutMs);
  });
  try {
    const value = await Promise.race([task(), timeout]);
    return { ok: true, value };
  } catch (err) {
    if (err instanceof Error && err.message === 'share-export-timeout') return { ok: false, reason: 'timeout' };
    return { ok: false, reason: 'failed' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export type ShareImageJobResult = {
  ok: boolean;
  timedOut: boolean;
  noticeKey: 'shareExportFailed' | 'shareImageSaved' | 'shareImageShared' | 'shareImageLongPress' | null;
  ready: boolean;
  imageDisabled: boolean;
  pdfDisabled: boolean;
  file: File | null;
};

/**
 * Run one image export. Timeout and failure clear the busy flag,
 * dismiss the second-step save button, and surface the retry hint.
 * iOS does not call share here; the ready button waits for a fresh tap.
 */
export async function settleShareImageExport(options: {
  canExport: boolean;
  filename: string;
  ios: boolean;
  timeoutMs?: number;
  capture: () => Promise<Blob>;
  deliver?: (file: File) => Promise<ShareImageOutcome>;
}): Promise<ShareImageJobResult> {
  const buttons = () => shareExportControlState(options.canExport, false);
  const failed = (timedOut: boolean): ShareImageJobResult => {
    const state = buttons();
    return {
      ok: false,
      timedOut,
      noticeKey: 'shareExportFailed',
      ready: false,
      imageDisabled: state.imageDisabled,
      pdfDisabled: state.pdfDisabled,
      file: null,
    };
  };
  const captured = await runTimedShareCapture(options.capture, options.timeoutMs ?? SHARE_CAPTURE_TIMEOUT_MS);
  if (!captured.ok) return failed(captured.reason === 'timeout');
  const file = pngFile(captured.value, options.filename);
  if (options.ios) {
    const state = buttons();
    return {
      ok: true,
      timedOut: false,
      noticeKey: null,
      ready: true,
      imageDisabled: state.imageDisabled,
      pdfDisabled: state.pdfDisabled,
      file,
    };
  }
  try {
    const deliver = options.deliver ?? ((next) => deliverSharePng(next, { userGesture: false, ios: false }));
    const outcome = await deliver(file);
    const state = buttons();
    if (outcome === 'cancelled') {
      return {
        ok: true,
        timedOut: false,
        noticeKey: null,
        ready: false,
        imageDisabled: state.imageDisabled,
        pdfDisabled: state.pdfDisabled,
        file: null,
      };
    }
    if (outcome === 'needs-gesture') {
      return {
        ok: true,
        timedOut: false,
        noticeKey: null,
        ready: true,
        imageDisabled: state.imageDisabled,
        pdfDisabled: state.pdfDisabled,
        file,
      };
    }
    return {
      ok: true,
      timedOut: false,
      noticeKey: shareImageNoticeKey(outcome),
      ready: false,
      imageDisabled: state.imageDisabled,
      pdfDisabled: state.pdfDisabled,
      file: null,
    };
  } catch {
    return failed(false);
  }
}

function browserShareTarget(): ShareFileTarget | null {
  const nav = navigator as Navigator & ShareFileTarget;
  return nav;
}

/**
 * Hand a finished PNG to the user.
 * After capture, iOS does not call share: the page shows a second button and
 * this runs again on that tap (`userGesture`). A share blocked on that tap
 * falls through to preview or download instead of failing quietly.
 * iOS does not pretend an `<a download>` succeeded.
 */
export async function deliverSharePng(
  file: File,
  options: {
    nav?: ShareFileTarget | null;
    ios?: boolean;
    hint?: string;
    download?: (file: File) => void;
    openPreview?: (file: File, hint: string) => boolean;
    /** False just after capture. True on the second-step tap. */
    userGesture?: boolean;
    /** `wait` keeps the second-step button. `fallback` downloads or opens a preview. */
    shareBlocked?: 'wait' | 'fallback';
  } = {},
): Promise<ShareImageOutcome> {
  const nav = options.nav === undefined ? browserShareTarget() : options.nav;
  const ios = options.ios ?? isIosDevice(navigator.userAgent, navigator.maxTouchPoints || 0);
  const hint = options.hint ?? '';
  const download = options.download ?? downloadShareFile;
  const openPreview = options.openPreview ?? ((next, text) => openShareImagePreview(next, text));
  const userGesture = options.userGesture === true;
  const shareBlocked = options.shareBlocked ?? (userGesture ? 'fallback' : 'wait');

  if (ios && !userGesture) return 'needs-gesture';

  if (canShareImageFile(file, nav) && typeof nav?.share === 'function') {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (isAbortError(err)) return 'cancelled';
      if (isGestureBlocked(err) && shareBlocked !== 'fallback') return 'needs-gesture';
    }
  }

  if (ios) {
    return openPreview(file, hint) ? 'preview' : 'needs-gesture';
  }

  try {
    download(file);
    return 'downloaded';
  } catch {
    return openPreview(file, hint) ? 'preview' : 'needs-gesture';
  }
}

type ShareSvg = (node: HTMLElement, options: ShareImageOptions & { width?: number; height?: number }) => Promise<string>;

async function loadSvg(): Promise<ShareSvg> {
  const mod = await import('html-to-image');
  return (node, options) => mod.toSvg(node, options);
}

function readNodeSize(node: HTMLElement, width?: number, height?: number) {
  const measuredWidth = Math.ceil(Number(node.scrollWidth || node.clientWidth) || 0);
  const measuredHeight = Math.ceil(Number(node.scrollHeight || node.clientHeight) || 0);
  return {
    width: Math.max(1, width ?? (measuredWidth || 1)),
    height: Math.max(1, height ?? (measuredHeight || 1)),
  };
}

async function paintShareCanvas(image: CanvasImageSource, width: number, height: number, pixelRatio: number) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.min(SHARE_CANVAS_EDGE_LIMIT, Math.floor(width * pixelRatio)));
  canvas.height = Math.max(1, Math.min(SHARE_CANVAS_EDGE_LIMIT, Math.floor(height * pixelRatio)));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('export-image-failed');
  context.fillStyle = '#f5f9fc';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((next) => resolve(next), 'image/png');
  });
  if (!blob) throw new Error('export-image-failed');
  return blob;
}

async function emptyWarmupNode() {
  const node = document.createElement('div');
  node.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  node.style.width = '8px';
  node.style.height = '8px';
  node.textContent = ' ';
  return node;
}

/**
 * PNG of the sheet on screen.
 * Uses toSvg plus our own image load so a hung `img.decode()` cannot stick.
 * Safari gets one empty warm-up first. The whole call rejects at 20 seconds.
 */
export async function captureSharePng(
  node: HTMLElement,
  deps: {
    toBlob?: ShareRaster;
    toSvg?: ShareSvg;
    loadImage?: (url: string) => Promise<CaptureImage>;
    paint?: (image: CaptureImage, width: number, height: number, pixelRatio: number) => Promise<Blob>;
    warmup?: () => Promise<void>;
    safari?: boolean;
    width?: number;
    height?: number;
    timeoutMs?: number;
    markCapturing?: (active: boolean) => void;
  } = {},
): Promise<Blob> {
  const mark = deps.markCapturing ?? defaultMarkCapturing;
  mark(true);
  try {
    const outcome = await runTimedShareCapture(
      () => captureSharePngBody(node, deps),
      deps.timeoutMs ?? SHARE_CAPTURE_TIMEOUT_MS,
    );
    if (!outcome.ok) {
      throw new Error(outcome.reason === 'timeout' ? 'share-export-timeout' : 'export-image-failed');
    }
    return outcome.value;
  } finally {
    mark(false);
  }
}

async function captureSharePngBody(
  node: HTMLElement,
  deps: {
    toBlob?: ShareRaster;
    toSvg?: ShareSvg;
    loadImage?: (url: string) => Promise<CaptureImage>;
    paint?: (image: CaptureImage, width: number, height: number, pixelRatio: number) => Promise<Blob>;
    warmup?: () => Promise<void>;
    safari?: boolean;
    width?: number;
    height?: number;
  },
) {
  const safari =
    deps.safari ??
    (typeof navigator !== 'undefined' && needsSafariWarmup(navigator.userAgent || '', navigator.maxTouchPoints || 0));
  if (safari) {
    try {
      if (deps.warmup) await deps.warmup();
      else if (deps.toBlob) await deps.toBlob(node, shareImageCaptureOptions(1));
      else await warmupShareCapture(deps.toSvg, deps.loadImage);
    } catch {
      /* The empty run is only a primer. */
    }
  }

  const { width, height } = readNodeSize(node, deps.width, deps.height);
  const ratio = shareImagePixelRatio(width, height);
  if (deps.toBlob) {
    const raster = deps.toBlob;
    let blob: Blob | null = null;
    try {
      blob = await raster(node, shareImageCaptureOptions(ratio));
    } catch {
      blob = null;
    }
    if (!blob && ratio > 1) {
      try {
        blob = await raster(node, shareImageCaptureOptions(1));
      } catch {
        blob = null;
      }
    }
    if (!blob) throw new Error('export-image-failed');
    return blob;
  }

  const toSvg = deps.toSvg ?? (await loadSvg());
  const loadImage = deps.loadImage ?? ((url: string) => loadCaptureImage(url));
  const paint =
    deps.paint ??
    ((image, w, h, pixelRatio) => paintShareCanvas(image as CanvasImageSource, w, h, pixelRatio));
  let primary: Blob | null = null;
  try {
    const svg = await toSvg(node, { ...shareImageCaptureOptions(ratio), width, height });
    const image = await loadImage(svg);
    primary = await paint(image, width, height, ratio);
  } catch {
    primary = null;
  }
  if (primary) return primary;
  if (ratio <= 1) throw new Error('export-image-failed');
  const svg = await toSvg(node, { ...shareImageCaptureOptions(1), width, height });
  const image = await loadImage(svg);
  return paint(image, width, height, 1);
}

async function warmupShareCapture(toSvg?: ShareSvg, loadImage?: (url: string) => Promise<CaptureImage>) {
  const render = toSvg ?? (await loadSvg());
  const load = loadImage ?? ((url: string) => loadCaptureImage(url, { decodeTimeoutMs: 800 }));
  const node = await emptyWarmupNode();
  const svg = await render(node, { ...shareImageCaptureOptions(1), width: 8, height: 8 });
  await load(svg);
}
