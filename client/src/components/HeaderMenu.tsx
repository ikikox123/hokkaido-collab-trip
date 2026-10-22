import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { LanguageMenu } from '../i18n/LanguageMenu';
import type { ShareLang, ShareScope } from '../lib/sharePath';
import { ShareActionList } from './ShareMenu';
import { THEMES, useTheme, type ThemeId } from './theme';

const EXIT_MS = 240;

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type Account = { name: string; onLogout: () => void };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shareScope: ShareScope;
  lang: ShareLang;
  account?: Account | null;
  onLogin?: () => void;
  /** Extra trip sections (room, lodging, flights...) rendered between share and display. */
  children?: ReactNode;
};

const SWATCH: Record<ThemeId, string[]> = {
  a: ['#c7b5ee', '#52b8df', '#a6d985', '#e8583e'],
  b: ['#fcfcfa', '#1f2a44', '#4e8c86', '#e7e7e2'],
  c: ['#0b1030', '#7b5cf0', '#3dffa8', '#5be0ff'],
};

export const menuItemClass =
  'menu-item cute-press flex min-h-touch w-full items-center gap-3 rounded-2xl px-3 text-left text-[15px] font-semibold text-ink hover:bg-lavender-100';

function ThemePicker() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const names: Record<ThemeId, [string, string]> = {
    a: [t('themeA'), t('themeAHint')],
    b: [t('themeB'), t('themeBHint')],
    c: [t('themeC'), t('themeCHint')],
  };
  return (
    <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('themeTitle')}>
      {THEMES.map((id) => {
        const active = theme === id;
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            onClick={() => setTheme(id)}
            className={`theme-option cute-press flex min-h-touch flex-col items-stretch gap-1.5 rounded-2xl border-2 p-2 text-left ${
              active ? 'border-ink bg-lavender-100 shadow-sticker-sm' : 'border-slate-200 bg-white'
            }`}
          >
            <span className={`theme-swatch theme-swatch-${id} flex h-7 overflow-hidden`} aria-hidden>
              {SWATCH[id].map((color) => (
                <span key={color} className="flex-1" style={{ background: color }} />
              ))}
            </span>
            <span className="text-sm font-bold leading-tight text-ink">{names[id][0]}</span>
            <span className="text-[11px] leading-snug text-slate-500">{names[id][1]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** One round header button that opens a sheet (phone) or dropdown (desktop) with every header action. */
export function HeaderMenu({ open, onOpenChange, shareScope, lang, account, onLogin, children }: Props) {
  const { t } = useI18n();
  const id = useId();
  const titleId = `${id}-title`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(open);
  const close = () => onOpenChange(false);

  // Keep the sheet mounted for its exit animation.
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    if (!mounted) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => setMounted(false), reduce ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);

  // Focus the first control on open; hand focus back to the trigger on close.
  useLayoutEffect(() => {
    if (open && mounted) {
      const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE);
      first?.focus({ preventScroll: true });
    }
  }, [open, mounted]);
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  function trapTab(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
      (el) => el.offsetParent !== null,
    );
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const sheet = mounted
    ? createPortal(
        <div className="menu-layer fixed inset-0 z-50" data-state={open ? 'open' : 'closed'} data-share-export-ignore="true">
          <div className="menu-backdrop absolute inset-0" onClick={close} aria-hidden />
          <div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onKeyDown={trapTab}
            className="menu-sheet th-glass absolute inset-x-0 bottom-0 flex max-h-[86dvh] flex-col overflow-hidden rounded-t-3xl border-2 border-b-0 border-ink bg-snow-50 text-ink shadow-sticker md:inset-x-auto md:bottom-auto md:right-3 md:top-[calc(var(--safe-top)+3.75rem)] md:max-h-[calc(100dvh-5rem)] md:w-[25rem] md:rounded-3xl md:border-b-2"
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-slate-300 md:hidden" aria-hidden />
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pb-1 pt-2">
              <h2 id={titleId} className="text-base font-bold">
                {t('menu')}
              </h2>
              <button
                type="button"
                className="cute-press flex h-11 w-11 items-center justify-center rounded-full border-2 border-ink bg-white text-ink"
                aria-label={t('headerMenuClose')}
                onClick={close}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>
            <div className="menu-body min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,var(--safe-bottom))] pt-1">
              <section className="menu-section">
                <h3 className="menu-heading">{t('menuShareSection')}</h3>
                <div className="grid gap-1">
                  <ShareActionList scope={shareScope} lang={lang} itemClassName={menuItemClass} onBeforeExport={close} />
                </div>
              </section>
              {children}
              <section className="menu-section">
                <h3 className="menu-heading">{t('menuDisplaySection')}</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold text-slate-700">{t('language')}</span>
                    <LanguageMenu tone="light" />
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-slate-700">{t('themeTitle')}</p>
                    <ThemePicker />
                  </div>
                </div>
              </section>
              {(account || onLogin) && (
                <section className="menu-section">
                  <h3 className="menu-heading">{t('menuAccountSection')}</h3>
                  {account ? (
                    <div className="flex items-center gap-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-700" title={account.name}>
                        {t('signedInAs', { name: account.name })}
                      </p>
                      <button
                        type="button"
                        className="cute-pop min-h-touch shrink-0 rounded-full border-2 border-ink bg-butter-100 px-4 text-sm font-bold text-ink shadow-sticker-sm"
                        onClick={() => {
                          close();
                          account.onLogout();
                        }}
                      >
                        {t('logOut')}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="cute-pop min-h-touch w-full rounded-full border-2 border-ink bg-lavender-300 px-4 text-sm font-bold text-ink shadow-sticker-sm"
                      onClick={() => {
                        close();
                        onLogin?.();
                      }}
                    >
                      {t('login')}
                    </button>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="header-menu-trigger cute-press relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-white text-ink shadow-sticker-sm"
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        aria-label={open ? t('headerMenuClose') : t('headerMenuOpen')}
        data-open={open || undefined}
        onClick={() => onOpenChange(!open)}
      >
        <span className="burger" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </button>
      {sheet}
    </>
  );
}
