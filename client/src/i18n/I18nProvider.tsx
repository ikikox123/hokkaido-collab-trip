import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { applyDocumentTitle } from './screen.ts';
import { htmlLang, text, type Locale, type MessageKey, type Vars } from './messages.ts';
import { readLocale, writeLocale } from './storage.ts';

export type Translate = (key: MessageKey, vars?: Vars) => string;

type I18nValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translate;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    writeLocale(next);
  }, []);

  const t = useCallback<Translate>((key, vars) => text(locale, key, vars), [locale]);

  useEffect(() => {
    document.documentElement.lang = htmlLang(locale);
    applyDocumentTitle(locale, document);
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}
