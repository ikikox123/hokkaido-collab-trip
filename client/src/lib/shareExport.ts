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

export function openShareImagePreview(
  file: File,
  hint: string,
  openImpl: (url?: string | URL, target?: string) => { document: PreviewDocument } | null = (url, target) =>
    window.open(url, target),
) {
  const imageUrl = URL.createObjectURL(file);
  const popup = openImpl('', '_blank');
  if (!popup) {
    URL.revokeObjectURL(imageUrl);
    return false;
  }
  popup.document.open();
  popup.document.write(shareImagePreviewHtml(imageUrl, hint, file.name));
  popup.document.close();
  return true;
}

function browserShareTarget(): ShareFileTarget | null {
  const nav = navigator as Navigator & ShareFileTarget;
  return nav;
}

/**
 * Hand a finished PNG to the user.
 * Share runs only when this is called inside a click. A blocked share returns
 * `needs-gesture` so the page can offer a second tap. iOS does not pretend an
 * `<a download>` succeeded.
 */
export async function deliverSharePng(
  file: File,
  options: {
    nav?: ShareFileTarget | null;
    ios?: boolean;
    hint?: string;
    download?: (file: File) => void;
    openPreview?: (file: File, hint: string) => boolean;
  } = {},
): Promise<ShareImageOutcome> {
  const nav = options.nav === undefined ? browserShareTarget() : options.nav;
  const ios = options.ios ?? isIosDevice(navigator.userAgent, navigator.maxTouchPoints || 0);
  const hint = options.hint ?? '';
  const download = options.download ?? downloadShareFile;
  const openPreview = options.openPreview ?? ((next, text) => openShareImagePreview(next, text));

  if (canShareImageFile(file, nav) && typeof nav?.share === 'function') {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (isAbortError(err)) return 'cancelled';
      if (isGestureBlocked(err)) return 'needs-gesture';
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

async function loadRaster(): Promise<ShareRaster> {
  const mod = await import('html-to-image');
  return (node, options) => mod.toBlob(node, options);
}

/** PNG of the sheet that is on screen. Retries once at 1x if the tall trip image is too large. */
export async function captureSharePng(
  node: HTMLElement,
  deps: {
    toBlob?: ShareRaster;
    markCapturing?: (active: boolean) => void;
  } = {},
): Promise<Blob> {
  const raster = deps.toBlob ?? (await loadRaster());
  const mark = deps.markCapturing ?? defaultMarkCapturing;
  mark(true);
  try {
    let blob: Blob | null = null;
    try {
      blob = await raster(node, shareImageCaptureOptions(2));
    } catch {
      blob = null;
    }
    if (!blob) blob = await raster(node, shareImageCaptureOptions(1));
    if (!blob) throw new Error('export-image-failed');
    return blob;
  } finally {
    mark(false);
  }
}
