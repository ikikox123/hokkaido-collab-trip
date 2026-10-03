import { type Locale } from './messages.ts';

/** Browser preference only. Never written to data/state.json or the trip payload. */
export const LOCALE_STORAGE_KEY = 'hokkaido.locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'zh-Hant' || value === 'ja' || value === 'en';
}

type LocaleStore = { getItem(key: string): string | null };

function browserStore(): LocaleStore | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

export function readLocale(storage: LocaleStore | null = browserStore()): Locale {
  try {
    const raw = storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
    return isLocale(raw) ? raw : 'zh-Hant';
  } catch {
    return 'zh-Hant';
  }
}

export function writeLocale(locale: Locale) {
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    /* Keep the choice in memory for this visit. */
  }
}
