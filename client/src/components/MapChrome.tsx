import type { TravelMode } from '../types/trip';
import { useI18n } from '../i18n/I18nProvider';
import { travelLabel } from '../i18n/labels';
import { MODE_COLORS } from '../lib/travel';

export function MapChrome({
  empty,
  modes,
  providerLabel,
}: {
  empty: boolean;
  modes: TravelMode[];
  providerLabel?: string;
}) {
  const { t } = useI18n();
  return (
    <>
      {empty && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-sm text-slate-500 shadow">
          {t('noStopsOnMap')}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[400] max-w-[78%] rounded-lg bg-white/95 px-2.5 py-1.5 text-sm leading-snug text-slate-700 shadow">
        {providerLabel && <div className="font-medium text-slate-700">{providerLabel}</div>}
        <div>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-sakura-500 align-middle" />
          {t('nextStop')}
          <span className="ml-2 mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ice-600 align-middle" />
          {t('selectedStop')}
        </div>
        {modes.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {modes.map((mode) => (
              <span key={mode}>
                <span
                  className="mr-1 inline-block h-1.5 w-3 align-middle"
                  style={{ background: MODE_COLORS[mode] }}
                />
                {travelLabel(t, mode)}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
