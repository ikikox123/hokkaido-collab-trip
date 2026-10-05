import { useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { shareOrCopy, sharePageUrl } from '../lib/shareLink';
import type { ShareLang, ShareScope } from '../lib/sharePath';

export function ShareLinkButton({
  scope,
  lang,
  tone = 'light',
}: {
  scope: ShareScope;
  lang: ShareLang;
  tone?: 'onDark' | 'light';
}) {
  const { t } = useI18n();
  const [notice, setNotice] = useState<string | null>(null);
  const face =
    tone === 'light'
      ? 'border border-slate-200 bg-white text-ice-700'
      : 'border border-white/30 bg-white/15 text-white';

  async function onShare() {
    const url = sharePageUrl(window.location.origin, scope, lang);
    try {
      const mode = await shareOrCopy(url);
      setNotice(mode === 'copied' ? t('shareCopied') : t('shareOpened'));
      window.setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof Error && err.name === 'AbortError') return;
      setNotice(t('shareCopyFailed'));
      window.setTimeout(() => setNotice(null), 2500);
    }
  }

  return (
    <>
      <button
        type="button"
        className={`min-h-touch shrink-0 rounded-lg px-2 text-sm font-bold ${face}`}
        onClick={() => void onShare()}
      >
        {t('shareLink')}
      </button>
      {notice && (
        <div
          role="status"
          className="fixed left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2.5 text-sm text-white shadow-lg bottom-[calc(1rem+var(--safe-bottom))]"
        >
          {notice}
        </div>
      )}
    </>
  );
}
