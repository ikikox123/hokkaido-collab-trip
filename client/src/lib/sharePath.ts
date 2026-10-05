/** Read-only itinerary sheet. The day query is navigation only. `lang` is display-only. */
export const SHARE_PATH = '/share';

export type ShareScope = { kind: 'all' } | { kind: 'day'; day: number };

export type ShareLang = 'zh-Hant' | 'ja' | 'en';

export function isSharePath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === SHARE_PATH;
}

/** Empty or missing `day` means the whole trip. Anything else that is not a day index stays on one day and resolves later. */
export function parseShareScope(search: string): ShareScope {
  const raw = new URLSearchParams(search).get('day');
  if (raw == null || raw.trim() === '') return { kind: 'all' };
  if (!/^[1-9]\d{0,2}$/.test(raw.trim())) return { kind: 'day', day: 0 };
  return { kind: 'day', day: Number(raw) };
}

export function parseShareLang(search: string): ShareLang | null {
  const raw = new URLSearchParams(search).get('lang');
  if (raw === 'zh-Hant' || raw === 'ja' || raw === 'en') return raw;
  return null;
}

/** Day and language only. Never carries a token, password, or account id. */
export function shareLocation(scope: ShareScope, lang?: ShareLang | null) {
  const params = new URLSearchParams();
  if (scope.kind === 'day' && Number.isInteger(scope.day) && scope.day > 0) {
    params.set('day', String(scope.day));
  }
  if (lang === 'zh-Hant' || lang === 'ja' || lang === 'en') params.set('lang', lang);
  const query = params.toString();
  return query ? `${SHARE_PATH}?${query}` : SHARE_PATH;
}
