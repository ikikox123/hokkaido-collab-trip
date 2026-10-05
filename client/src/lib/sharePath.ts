/** Read-only itinerary sheet. The day query is navigation only. */
export const SHARE_PATH = '/share';

export type ShareScope = { kind: 'all' } | { kind: 'day'; day: number };

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

export function shareLocation(scope: ShareScope) {
  if (scope.kind === 'day' && Number.isInteger(scope.day) && scope.day > 0) {
    return `${SHARE_PATH}?day=${scope.day}`;
  }
  return SHARE_PATH;
}
