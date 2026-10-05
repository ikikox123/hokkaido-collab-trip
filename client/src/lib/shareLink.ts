import { shareLocation, type ShareLang, type ShareScope } from './sharePath.ts';

/** Absolute share URL. Query is only `day` and `lang`. */
export function sharePageUrl(origin: string, scope: ShareScope, lang: ShareLang) {
  const base = origin.replace(/\/$/, '');
  return `${base}${shareLocation(scope, lang)}`;
}

function aborted(err: unknown) {
  return (err instanceof DOMException || (err instanceof Error && err.name === 'AbortError')) && err.name === 'AbortError';
}

/**
 * Use the platform share sheet when the browser offers one.
 * Otherwise copy the URL. A cancelled share sheet is rethrown so the caller stays quiet.
 */
export async function shareOrCopy(url: string): Promise<'shared' | 'copied'> {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ url });
      return 'shared';
    } catch (err) {
      if (aborted(err)) throw err;
    }
  }
  if (!nav?.clipboard?.writeText) throw new Error('copy-failed');
  await nav.clipboard.writeText(url);
  return 'copied';
}
