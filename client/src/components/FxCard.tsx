import { useState } from 'react';
import type { FxView } from '../../../server/src/fx.js';
import { localizeError } from '../i18n/errors';
import { useI18n } from '../i18n/I18nProvider';
import { intlLocale } from '../i18n/messages';

type Basis = 'twdPerJpy' | 'jpyPerTwd';

type Props = {
  fx: FxView | null;
  canEdit: boolean;
  pending: boolean;
  onOverride: (basis: Basis, value: string) => void;
  onClear: () => void;
};

const taipei = {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
} as const;

function formatWhen(iso: string | null | undefined, locale: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, taipei).format(date);
}

function formatRate(value: number, locale: string) {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
}

export function FxCard({ fx, canEdit, pending, onOverride, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<Basis>('twdPerJpy');
  const [value, setValue] = useState('');
  const { t, locale } = useI18n();
  const dateLocale = intlLocale(locale);
  const effective = fx?.effective ?? null;
  const manual = effective?.source === 'manual';

  return (
    <section className="rounded-2xl border border-ice-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ice-700">{t('fxTitle')}</h3>
        {effective && (
          <span
            className={`shrink-0 rounded-md px-2 py-1 text-sm font-bold ${
              manual ? 'bg-sakura-500 text-white' : 'bg-ice-600 text-white'
            }`}
          >
            {manual ? t('manualRate') : t('liveRate')}
          </span>
        )}
      </div>

      {!effective ? (
        <p className="mt-2 text-base text-slate-700">{t('noRateKeep')}</p>
      ) : (
        <div className="mt-2 space-y-1">
          <p className="text-lg font-bold text-slate-900">{t('oneYen', { rate: formatRate(effective.twdPerJpy, dateLocale) })}</p>
          <p className="text-lg font-bold text-slate-900">{t('oneTwd', { rate: formatRate(effective.jpyPerTwd, dateLocale) })}</p>
          {fx?.quote?.fetchedAt && (
            <p className="text-sm text-slate-600">{t('lastSuccess', { time: formatWhen(fx.quote.fetchedAt, dateLocale) })}</p>
          )}
          {!manual && effective.marketTime && (
            <p className="text-sm text-slate-600">{t('marketTime', { time: formatWhen(effective.marketTime, dateLocale) })}</p>
          )}
          {manual && (
            <p className="text-sm font-semibold text-sakura-500">
              {effective.by || effective.at
                ? t('usingManualMeta', {
                    meta: [effective.by, effective.at ? formatWhen(effective.at, dateLocale) : ''].filter(Boolean).join(t('metaSep')),
                  })
                : t('usingManual')}
            </p>
          )}
          {manual && fx?.quote && (
            <p className="text-sm text-slate-500">
              {fx.quote.fetchedAt
                ? t('lastLiveAt', {
                    rate: formatRate(fx.quote.twdPerJpy, dateLocale),
                    time: formatWhen(fx.quote.fetchedAt, dateLocale),
                  })
                : t('lastLive', { rate: formatRate(fx.quote.twdPerJpy, dateLocale) })}
            </p>
          )}
          {effective.stale && fx?.error && (
            <p className="text-sm font-semibold text-amber-700">{localizeError(fx.error, t)}</p>
          )}
        </div>
      )}

      {fx?.error && !effective && <p className="mt-1 text-sm text-slate-500">{localizeError(fx.error, t)}</p>}

      {canEdit && (
        <div className="mt-3">
          <button
            type="button"
            className="min-h-touch text-sm font-bold text-ice-700"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? t('collapseManual') : manual ? t('editManual') : t('useManual')}
          </button>
          {open && (
            <form
              className="mt-2 space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (pending || !value.trim()) return;
                onOverride(basis, value.trim());
              }}
            >
              <div className="grid grid-cols-1 gap-2">
                <button
                  type="button"
                  className={`min-h-touch rounded-xl px-3 text-left text-sm font-bold ${
                    basis === 'twdPerJpy' ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
                  }`}
                  onClick={() => setBasis('twdPerJpy')}
                >
                  {t('yenEquals')}
                </button>
                <button
                  type="button"
                  className={`min-h-touch rounded-xl px-3 text-left text-sm font-bold ${
                    basis === 'jpyPerTwd' ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
                  }`}
                  onClick={() => setBasis('jpyPerTwd')}
                >
                  {t('twdEquals')}
                </button>
              </div>
              <input
                inputMode="decimal"
                className="w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base"
                placeholder={basis === 'twdPerJpy' ? '0.20' : '5'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-label={t('manualRateAria')}
              />
              <button
                type="submit"
                disabled={pending || !value.trim()}
                className="min-h-touch w-full rounded-xl bg-ice-600 text-base font-bold text-white disabled:opacity-50"
              >
                {t('applyManual')}
              </button>
              {manual && (
                <button
                  type="button"
                  disabled={pending}
                  className="min-h-touch w-full rounded-xl border border-slate-200 text-base font-bold text-slate-700 disabled:opacity-50"
                  onClick={onClear}
                >
                  {t('backToLive')}
                </button>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
