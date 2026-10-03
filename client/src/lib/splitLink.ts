/** Stable split page on this site. One path for the room, no install. */
export const SPLIT_PATH = '/split';

export function isSplitPath(pathname: string) {
  const path = pathname.replace(/\/+$/, '') || '/';
  return path === SPLIT_PATH;
}

export function splitPageUrl(origin: string) {
  return `${origin.replace(/\/$/, '')}${SPLIT_PATH}`;
}

/** Bare URL on the first line, then one short Traditional Chinese line. */
export function splitShareText(origin: string) {
  return `${splitPageUrl(origin)}\n北海道分帳，點開就能看帳、記一筆`;
}

export function openSplit() {
  if (typeof window === 'undefined') return;
  if (!isSplitPath(window.location.pathname)) {
    window.history.pushState({ view: 'split' }, '', SPLIT_PATH);
  }
}

export function leaveSplit() {
  if (typeof window === 'undefined') return;
  if (isSplitPath(window.location.pathname)) {
    window.history.pushState({ view: 'trip' }, '', '/');
  }
}
