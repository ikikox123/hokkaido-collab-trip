import type { TravelMode } from '../types/trip';
import { MODE_COLORS, MODE_LABELS } from '../lib/travel';

export function MapChrome({
  empty,
  modes,
  providerLabel,
}: {
  empty: boolean;
  modes: TravelMode[];
  providerLabel?: string;
}) {
  return (
    <>
      {empty && (
        <div className="pointer-events-none absolute left-1/2 top-3 z-[400] -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-sm text-slate-500 shadow">
          這天還沒有站點
        </div>
      )}
      <div className="pointer-events-none absolute bottom-2 left-2 z-[400] max-w-[70%] rounded-lg bg-white/95 px-2 py-1 text-[10px] leading-snug text-slate-600 shadow">
        {providerLabel && <div className="font-medium text-slate-700">{providerLabel}</div>}
        <div>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-sakura-500 align-middle" />
          下一站
          <span className="ml-2 mr-1 inline-block h-2.5 w-2.5 rounded-full bg-ice-600 align-middle" />
          選中
        </div>
        {modes.length > 0 && (
          <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5">
            {modes.map((mode) => (
              <span key={mode}>
                <span
                  className="mr-1 inline-block h-1.5 w-3 align-middle"
                  style={{ background: MODE_COLORS[mode] }}
                />
                {MODE_LABELS[mode]}
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
