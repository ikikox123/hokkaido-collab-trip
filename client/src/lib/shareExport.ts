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

export function saveShareBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

async function loadRaster(): Promise<ShareRaster> {
  const mod = await import('html-to-image');
  return (node, options) => mod.toBlob(node, options);
}

/** PNG of the sheet that is on screen. Retries once at 1x if the tall trip image is too large. */
export async function captureSharePng(
  node: HTMLElement,
  filename: string,
  deps: {
    toBlob?: ShareRaster;
    save?: (blob: Blob, filename: string) => void;
    markCapturing?: (active: boolean) => void;
  } = {},
): Promise<void> {
  const raster = deps.toBlob ?? (await loadRaster());
  const save = deps.save ?? saveShareBlob;
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
    save(blob, filename);
  } finally {
    mark(false);
  }
}
