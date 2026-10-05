import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isSharePath, parseShareLang } from '../lib/sharePath';
import { applyDocumentTitle } from './screen.ts';
import { htmlLang, text, type Locale, type MessageKey, type Vars } from './messages.ts';
import { readLocale, writeLocale } from './storage.ts';

export type Translate = (key: MessageKey, vars?: Vars) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Sheet language from `?lang=`. Does not write `hokkaido.locale`. */
  setDisplayLocale: (locale: Locale | null) => void;
  t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

function initialDisplayOverride(): Locale | null {
  if (typeof window === 'undefined') return null;
  if (!isSharePath(window.location.pathname)) return null;
  return parseShareLang(window.location.search);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [storedLocale, setStoredLocale] = useState<Locale>(() => readLocale());
  const [displayOverride, setDisplayOverride] = useState<Locale | null>(initialDisplayOverride);
  const locale = displayOverride ?? storedLocale;

  const setLocale = useCallback((next: Locale) => {
    setDisplayOverride(null);
    setStoredLocale(next);
    writeLocale(next);
  }, []);

  const setDisplayLocale = useCallback((next: Locale | null) => {
    setDisplayOverride(next);
  }, []);

  const t = useCallback<Translate>((key, vars) => text(locale, key, vars), [locale]);

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
    applyDocumentTitle(locale, document);
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, setDisplayLocale, t }),
    [locale, setLocale, setDisplayLocale, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
