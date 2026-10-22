import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { shareOrCopy, sharePageUrl } from '../lib/shareLink';
import { openShareExport, shareMenuPosition } from '../lib/shareExport';
import { shareLocation, type ShareLang, type ShareScope } from '../lib/sharePath';
import { ShareNotice, useTimedNotice } from './ShareNotice';

function ShareGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M7 8l5-5 5 5" />
      <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}

/** Copy / open / export handlers shared by the share popover and the header sheet. */
export function useShareActions(scope: ShareScope, lang: ShareLang) {
  const { t } = useI18n();
  const { notice, flash } = useTimedNotice();
  const href = shareLocation(scope, lang);

  async function onCopy() {
    const url = sharePageUrl(window.location.origin, scope, lang);
    try {
      const mode = await shareOrCopy(url);
      flash(mode === 'copied' ? t('shareCopied') : t('shareOpened'));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof Error && err.name === 'AbortError') return;
      flash(t('shareCopyFailed'));
    }
  }

  function onExport(kind: 'image' | 'pdf') {
    openShareExport(kind, scope, lang);
  }

  return { href, notice, onCopy, onExport };
}

/** The four share actions as a plain list, for the header sheet. */
export function ShareActionList({
  scope,
  lang,
  onBeforeExport,
  itemClassName,
}: {
  scope: ShareScope;
  lang: ShareLang;
  onBeforeExport?: () => void;
  itemClassName: string;
}) {
  const { t } = useI18n();
  const { href, notice, onCopy, onExport } = useShareActions(scope, lang);
  return (
    <>
      <button type="button" className={itemClassName} onClick={() => void onCopy()}>
        <ShareGlyph />
        <span>{t('copyLink')}</span>
      </button>
      <a href={href} className={itemClassName}>
        <span aria-hidden className="w-5 text-center">↗</span>
        <span>{t('shareOpenPage')}</span>
      </a>
      <button
        type="button"
        className={itemClassName}
        onClick={() => {
          onBeforeExport?.();
          onExport('image');
        }}
      >
        <span aria-hidden className="w-5 text-center">▣</span>
        <span>{t('shareExportImage')}</span>
      </button>
      <button
        type="button"
        className={itemClassName}
        onClick={() => {
          onBeforeExport?.();
          onExport('pdf');
        }}
      >
        <span aria-hidden className="w-5 text-center">⎙</span>
        <span>{t('shareExportPdf')}</span>
      </button>
      <ShareNotice message={notice} />
    </>
  );
}

/**
 * Header share control. It stays in the top row at every width
 * and is not placed inside the collapsible menu.
 */
export function ShareMenu({
  scope,
  lang,
  tone = 'onDark',
}: {
  scope: ShareScope;
  lang: ShareLang;
  tone?: 'onDark' | 'light';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const { href, notice, onCopy, onExport: exportAs } = useShareActions(scope, lang);
  const face =
    tone === 'light'
      ? 'border-2 border-ink bg-white text-ink'
      : 'border-2 border-ink bg-white text-ink shadow-sticker-sm';

  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setPos(shareMenuPosition(rect, window.innerWidth));
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDoc(event: MouseEvent) {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onExport(kind: 'image' | 'pdf') {
    setOpen(false);
    exportAs(kind);
  }

  const panel =
    open && pos
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="menu"
            aria-label={t('share')}
            data-share-export-ignore="true"
            className="share-export-ignore cute-enter fixed z-40 overflow-hidden rounded-2xl border-2 border-ink bg-white py-1 text-ink shadow-sticker"
            style={{ top: pos.top, left: pos.left, width: pos.width }}
          >
            <button type="button" role="menuitem" className="min-h-touch w-full px-3 text-left text-sm font-semibold hover:bg-lavender-100" onClick={() => void onCopy()}>
              {t('copyLink')}
            </button>
            <a role="menuitem" href={href} className="flex min-h-touch items-center px-3 text-sm font-semibold hover:bg-lavender-100">
              {t('shareOpenPage')}
            </a>
            <button type="button" role="menuitem" className="min-h-touch w-full px-3 text-left text-sm font-semibold hover:bg-lavender-100" onClick={() => onExport('image')}>
              {t('shareExportImage')}
            </button>
            <button type="button" role="menuitem" className="min-h-touch w-full px-3 text-left text-sm font-semibold hover:bg-lavender-100" onClick={() => onExport('pdf')}>
              {t('shareExportPdf')}
            </button>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        className={`cute-press inline-flex min-h-touch shrink-0 items-center justify-center gap-0.5 whitespace-nowrap rounded-full px-1.5 text-sm font-bold sm:gap-1 sm:px-2.5 ${face}`}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={panelId}
        aria-label={t('share')}
        onClick={() => setOpen((value) => !value)}
      >
        <ShareGlyph />
        <span>{t('share')}</span>
      </button>
      {panel}
      <ShareNotice message={notice} />
    </div>
  );
}
