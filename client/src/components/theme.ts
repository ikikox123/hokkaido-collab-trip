import { useCallback, useEffect, useState } from 'react';

// Per-device look. index.html applies the stored value before first paint; this keeps React in step.
export type ThemeId = 'a' | 'b' | 'c';
export const THEMES: ThemeId[] = ['a', 'b', 'c'];
const STORAGE_KEY = 'hokkaido-theme';
const THEME_EVENT = 'hokkaido-theme-change';
const THEME_COLOR: Record<ThemeId, string> = { a: '#fffcf5', b: '#fcfcfa', c: '#0b1030' };

function isTheme(value: unknown): value is ThemeId {
  return value === 'a' || value === 'b' || value === 'c';
}

export function storedTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (isTheme(value)) return value;
  } catch {
    /* storage blocked: fall back to the default look */
  }
  return 'a';
}

function paint(id: ThemeId) {
  document.documentElement.dataset.theme = id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[id]);
}

/** Switch look with a short cross-fade (View Transitions when available), instant under reduced motion. */
export function applyTheme(id: ThemeId, animate = true) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  if (!animate || reduce) paint(id);
  else if (typeof doc.startViewTransition === 'function') doc.startViewTransition(() => paint(id));
  else {
    const html = document.documentElement;
    html.classList.add('theme-fade');
    paint(id);
    window.setTimeout(() => html.classList.remove('theme-fade'), 420);
  }
  window.dispatchEvent(new CustomEvent(THEME_EVENT, { detail: id }));
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeId>(storedTheme);

  useEffect(() => {
    const sync = (event: Event) => {
      const next = (event as CustomEvent).detail;
      if (isTheme(next)) setThemeState(next);
    };
    window.addEventListener(THEME_EVENT, sync);
    return () => window.removeEventListener(THEME_EVENT, sync);
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* still switch for this visit */
    }
    applyTheme(id);
    setThemeState(id);
  }, []);

  return { theme, setTheme };
}
