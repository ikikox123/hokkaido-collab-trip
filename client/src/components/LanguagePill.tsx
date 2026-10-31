import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/I18nProvider';
import { COMPACT_LANGUAGE_OPTIONS } from '../i18n/LanguageMenu';
import type { Locale } from '../i18n/messages.ts';

const FULL_NAMES: Record<Locale, string> = { 'zh-Hant': '繁體中文', ja: '日本語', en: 'English' };
const EXIT_MS = 160;

/** Header language switch: a small pill showing 中 / 日 / EN that opens a popover of the three languages. */
export function LanguagePill() {
  const { locale, setLocale, t } = useI18n();
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const short = COMPACT_LANGUAGE_OPTIONS.find((option) => option.value === locale)?.label ?? '中';

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

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  // Focus the current language when the popover opens.
  useLayoutEffect(() => {
    if (open && mounted && pos) panelRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus({ preventScroll: true });
  }, [open, mounted, pos]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function pick(next: Locale) {
    setLocale(next);
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Tab') setOpen(false);
    if (next >= 0) {
      event.preventDefault();
      items[next]?.focus();
    }
  }

  function onTriggerKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault();
      setOpen(true);
    }
  }

  const panel =
    mounted && pos
      ? createPortal(
          <div
            ref={panelRef}
            id={id}
            role="menu"
            aria-label={t('language')}
            data-state={open ? 'open' : 'closed'}
            data-share-export-ignore="true"
            onKeyDown={onPanelKey}
            className="lang-pop th-glass fixed z-[55] w-44 overflow-hidden rounded-2xl border-2 border-ink bg-snow-50 p-1 text-ink shadow-sticker"
            style={{ top: pos.top, right: pos.right }}
          >
            {COMPACT_LANGUAGE_OPTIONS.map((option) => {
              const active = option.value === locale;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => pick(option.value)}
                  className={`lang-option flex min-h-touch w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[15px] font-semibold ${
                    active ? 'bg-lavender-100' : 'hover:bg-lavender-50'
                  }`}
                >
                  <span className="lang-code inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-lg border-2 border-ink bg-white text-xs font-bold">
                    {option.label}
                  </span>
                  <span className="min-w-0 flex-1">{FULL_NAMES[option.value]}</span>
                  <span aria-hidden className={`text-ice-600 ${active ? '' : 'invisible'}`}>
                    ✓
                  </span>
                </button>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="lang-pill btn btn-secondary cute-press shrink-0 !gap-1 !px-2.5"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${t('language')}：${FULL_NAMES[locale]}`}
        data-open={open || undefined}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKey}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" />
        </svg>
        <span className="min-w-[1.1rem] text-center leading-none">{short}</span>
        <svg className="lang-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
      {panel}
    </>
  );
}
