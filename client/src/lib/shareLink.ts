import { shareLocation, type ShareLang, type ShareScope } from './sharePath.ts';

/** Absolute share URL. Query is only `day` and `lang`. */
export function sharePageUrl(origin: string, scope: ShareScope, lang: ShareLang) {
  const base = origin.replace(/\/$/, '');
  return `${base}${shareLocation(scope, lang)}`;
}

function aborted(err: unknown) {
  return (err instanceof DOMException || (err instanceof Error && err.name === 'AbortError')) && err.name === 'AbortError';
}

/** The bits of `navigator` this helper uses. Tests pass a fake; the button uses the browser. */
export type ShareNavigator = {
  share?: (data: { url?: string; text?: string }) => Promise<void>;
  clipboard?: { writeText?: (value: string) => Promise<void> };
};

function browserNavigator(): ShareNavigator | null {
  const host = globalThis as { navigator?: ShareNavigator };
  return host.navigator ?? null;
}

/**
 * Use the platform share sheet when the browser offers one.
 * Otherwise copy the URL. A cancelled share sheet is rethrown so the caller stays quiet.
 */
export async function shareOrCopy(
  url: string,
  nav: ShareNavigator | null = browserNavigator(),
): Promise<'shared' | 'copied'> {
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
