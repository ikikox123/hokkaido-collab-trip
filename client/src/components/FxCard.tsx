import { useState } from 'react';
import type { FxView } from '../../../server/src/fx.js';

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

function formatWhen(iso: string | null | undefined) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-Hant-TW', taipei).format(date);
}

function formatRate(value: number) {
  return new Intl.NumberFormat('zh-Hant-TW', { maximumFractionDigits: 6 }).format(value);
}

export function FxCard({ fx, canEdit, pending, onOverride, onClear }: Props) {
  const [open, setOpen] = useState(false);
  const [basis, setBasis] = useState<Basis>('twdPerJpy');
  const [value, setValue] = useState('');
  const effective = fx?.effective ?? null;
  const manual = effective?.source === 'manual';

  return (
    <section className="rounded-2xl border border-ice-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold text-ice-700">日圓與新台幣</h3>
        {effective && (
          <span
            className={`shrink-0 rounded-md px-2 py-1 text-sm font-bold ${
              manual ? 'bg-sakura-500 text-white' : 'bg-ice-600 text-white'
            }`}
          >
            {manual ? '手動匯率' : '即時匯率'}
          </span>
        )}
      </div>

      {!effective ? (
        <p className="mt-2 text-base text-slate-700">目前拿不到匯率，先不換算。支出仍用原來的幣別記。</p>
      ) : (
        <div className="mt-2 space-y-1">
          <p className="text-lg font-bold text-slate-900">1 日圓 = {formatRate(effective.twdPerJpy)} 台幣</p>
          <p className="text-lg font-bold text-slate-900">1 台幣 = {formatRate(effective.jpyPerTwd)} 日圓</p>
          {fx?.quote?.fetchedAt && (
            <p className="text-sm text-slate-600">上次成功取得：{formatWhen(fx.quote.fetchedAt)}</p>
          )}
          {!manual && effective.marketTime && (
            <p className="text-sm text-slate-600">市場報價時間：{formatWhen(effective.marketTime)}</p>
          )}
          {manual && (
            <p className="text-sm font-semibold text-sakura-500">
              現在用的是手動匯率
              {(effective.by || effective.at) &&
                `（${[effective.by, effective.at ? formatWhen(effective.at) : ''].filter(Boolean).join('，')}）`}
            </p>
          )}
          {manual && fx?.quote && (
            <p className="text-sm text-slate-500">
              上次即時：1 日圓 = {formatRate(fx.quote.twdPerJpy)} 台幣
              {fx.quote.fetchedAt ? `（${formatWhen(fx.quote.fetchedAt)}）` : ''}
            </p>
          )}
          {effective.stale && fx?.error && <p className="text-sm font-semibold text-amber-700">{fx.error}</p>}
        </div>
      )}

      {fx?.error && !effective && <p className="mt-1 text-sm text-slate-500">{fx.error}</p>}

      {canEdit && (
        <div className="mt-3">
          <button
            type="button"
            className="min-h-touch text-sm font-bold text-ice-700"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
          >
            {open ? '收合手動匯率' : manual ? '修改手動匯率' : '改用手動匯率'}
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
                  1 日圓 = ? 台幣
                </button>
                <button
                  type="button"
                  className={`min-h-touch rounded-xl px-3 text-left text-sm font-bold ${
                    basis === 'jpyPerTwd' ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
                  }`}
                  onClick={() => setBasis('jpyPerTwd')}
                >
                  1 台幣 = ? 日圓
                </button>
              </div>
              <input
                inputMode="decimal"
                className="w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base"
                placeholder={basis === 'twdPerJpy' ? '0.20' : '5'}
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-label="手動匯率"
              />
              <button
                type="submit"
                disabled={pending || !value.trim()}
                className="min-h-touch w-full rounded-xl bg-ice-600 text-base font-bold text-white disabled:opacity-50"
              >
                套用手動匯率
              </button>
              {manual && (
                <button
                  type="button"
                  disabled={pending}
                  className="min-h-touch w-full rounded-xl border border-slate-200 text-base font-bold text-slate-700 disabled:opacity-50"
                  onClick={onClear}
                >
                  改回即時匯率
                </button>
              )}
            </form>
          )}
        </div>
      )}
    </section>
  );
}
