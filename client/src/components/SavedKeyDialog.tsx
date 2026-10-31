import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { localizeError } from '../i18n/errors';
import { createKey, getKeyInfo, revokeKey, type KeyInfo } from '../lib/saved';
import { SavedSheet } from './SavedSheet';

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="cute-pop min-h-touch shrink-0 rounded-full border-2 border-ink bg-butter-100 px-4 text-sm font-bold text-ink shadow-sticker-sm"
      aria-label={label}
      onClick={async () => {
        setDone(await copyText(text));
        window.setTimeout(() => setDone(false), 1800);
      }}
    >
      <span aria-live="polite">{done ? t('savedKeyCopied') : t('savedKeyCopy')}</span>
    </button>
  );
}

/** Make, replace, or revoke the Shortcut key. The key text exists only in this component's state, once. */
export function SavedKeyDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const { t, locale } = useI18n();
  const [info, setInfo] = useState<KeyInfo | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = `${window.location.origin}/api/saved/ingest`;

  useEffect(() => {
    let live = true;
    void getKeyInfo(token).then((result) => {
      if (!live) return;
      if (result?.ok) setInfo(result.data);
      else setError(result && !result.ok ? result.error : t('savedLoadFailed'));
    });
    return () => {
      live = false;
    };
  }, [token, t]);

  const make = useCallback(async () => {
    setBusy(true);
    setError(null);
    const result = await createKey(token);
    setBusy(false);
    if (result?.ok) {
      setFresh(result.data.key);
      setInfo({ hasKey: true, createdAt: result.data.createdAt });
    } else setError(result && !result.ok ? result.error : t('savedLoadFailed'));
  }, [token, t]);

  async function revoke() {
    if (!window.confirm(t('savedKeyRevokeConfirm'))) return;
    setBusy(true);
    setError(null);
    const result = await revokeKey(token);
    setBusy(false);
    if (result?.ok) {
      setFresh(null);
      setInfo(result.data);
    } else setError(result && !result.ok ? result.error : t('savedLoadFailed'));
  }

  const made = info?.createdAt
    ? new Date(info.createdAt).toLocaleDateString(locale === 'zh-Hant' ? 'zh-TW' : locale, { year: 'numeric', month: 'short', day: 'numeric' })
    : '';

  return (
    <SavedSheet title={t('savedKeyTitle')} onClose={onClose} closeLabel={t('close')}>
      <p className="text-sm leading-relaxed text-slate-600">{t('savedKeyHint')}</p>
      <p className="mt-3 text-sm font-semibold" aria-live="polite">
        {info ? (info.hasKey ? t('savedKeyHas', { date: made }) : t('savedKeyNone')) : '…'}
      </p>

      {fresh && (
        <div className="saved-key-reveal mt-3 rounded-2xl border-2 border-ink bg-mint-100 p-3">
          <p className="text-xs font-bold text-mint-800">{t('savedKeyOnce')}</p>
          <div className="mt-2 flex items-center gap-2">
            <code data-secret className="min-w-0 flex-1 break-all rounded-xl border-2 border-ink bg-white px-2 py-2 text-xs font-bold leading-snug text-ink">
              {fresh}
            </code>
            <CopyButton text={fresh} label={t('savedKeyCopy')} />
          </div>
        </div>
      )}

      <div className="mt-3 rounded-2xl border-2 border-dashed border-ink/40 p-3">
        <p className="text-xs leading-relaxed text-slate-600">{t('savedKeySetup')}</p>
        <div className="mt-2 flex items-center gap-2">
          <code className="min-w-0 flex-1 break-all text-xs font-semibold text-ink">{endpoint}</code>
          <CopyButton text={endpoint} label={t('savedKeyCopy')} />
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{localizeError(error, t)}</p>}

      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          disabled={busy || !info}
          onClick={() => void make()}
          className="cute-pop min-h-touch rounded-full border-2 border-ink bg-lavender-300 px-4 text-sm font-bold text-ink shadow-sticker-sm disabled:opacity-50"
        >
          {info?.hasKey ? t('savedKeyRemake') : t('savedKeyMake')}
        </button>
        {info?.hasKey && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void revoke()}
            className="cute-pop min-h-touch rounded-full border-2 border-ink bg-white px-4 text-sm font-bold text-crab-600 disabled:opacity-50"
          >
            {t('savedKeyRevoke')}
          </button>
        )}
        <button type="button" className="min-h-touch rounded-xl text-sm font-semibold text-slate-600" onClick={onClose}>
          {t('savedKeyClose')}
        </button>
      </div>
    </SavedSheet>
  );
}
