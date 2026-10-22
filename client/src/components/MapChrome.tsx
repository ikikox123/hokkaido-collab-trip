import type { TravelMode } from '../types/trip';
import { useI18n } from '../i18n/I18nProvider';
import { travelLabel } from '../i18n/labels';
import { STOP_MARKER_COLORS } from '../lib/stopMarker';
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
        <div className="pointer-events-none absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-full border-2 border-ink bg-white/95 px-3 py-1.5 text-sm font-semibold text-slate-600 shadow-sticker-sm">
          {t('noStopsOnMap')}
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[400] max-w-[78%] rounded-2xl border-2 border-ink bg-white/95 px-2.5 py-1.5 text-sm leading-snug text-ink shadow-sticker-sm">
        {providerLabel && <div className="font-medium text-slate-700">{providerLabel}</div>}
        <div>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-circle align-middle" style={{ background: STOP_MARKER_COLORS.next }} />
          {t('nextStop')}
          <span className="ml-2 mr-1 inline-block h-2.5 w-2.5 rounded-circle align-middle" style={{ background: STOP_MARKER_COLORS.selected }} />
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
