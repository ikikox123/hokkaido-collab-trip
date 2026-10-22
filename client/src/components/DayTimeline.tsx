import { useLayoutEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { displayDayLabel } from '../i18n/screen.ts';
import type { TripState } from '../types/trip';
import { Mascot } from './Cute';

type Props = {
  days: TripState['days'];
  selectedDay: number;
  onSelect: (day: number) => void;
};

type Geometry = { x: number; lineLeft: number; lineWidth: number };

/** Horizontal day timeline. Dots on a line; the mascot hops to the chosen day. */
export function DayTimeline({ days, selectedDay, onSelect }: Props) {
  const { t, locale } = useI18n();
  const trackRef = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const [geo, setGeo] = useState<Geometry | null>(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const measure = () => {
      const centers = days
        .map((d) => buttons.current.get(d.day))
        .filter((b): b is HTMLButtonElement => Boolean(b))
        .map((b) => b.offsetLeft + b.offsetWidth / 2);
      const chosen = buttons.current.get(selectedDay);
      if (!centers.length || !chosen) return;
      setGeo({
        x: chosen.offsetLeft + chosen.offsetWidth / 2,
        lineLeft: centers[0],
        lineWidth: centers[centers.length - 1] - centers[0],
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [days, selectedDay]);

  useLayoutEffect(() => {
    const chosen = buttons.current.get(selectedDay);
    const scroller = trackRef.current?.parentElement;
    if (!chosen || !scroller) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const target = chosen.offsetLeft + chosen.offsetWidth / 2 - scroller.clientWidth / 2;
    scroller.scrollTo({ left: Math.max(0, target), behavior: reduce ? 'auto' : 'smooth' });
  }, [selectedDay]);

  return (
    <nav aria-label={t('dayNav')} className="z-20 shrink-0 border-b-2 border-ink bg-snow-50">
      <div className="overflow-x-auto no-scrollbar px-1">
        <div ref={trackRef} className="relative flex min-w-full pt-8">
          {geo && (
            <>
              <span
                className="pointer-events-none absolute top-[2.6rem] h-[2.5px] rounded-full bg-ink"
                style={{ left: geo.lineLeft, width: geo.lineWidth }}
                aria-hidden
              />
              <span
                className="day-mascot pointer-events-none absolute left-0 top-0 z-10"
                style={{ transform: `translateX(${geo.x - 18}px)` }}
                aria-hidden
              >
                <span key={selectedDay} className="mascot-hop block">
                  <Mascot size={36} />
                </span>
              </span>
            </>
          )}
          {days.map((d) => {
            const active = d.day === selectedDay;
            return (
              <button
                key={d.day}
                ref={(el) => {
                  if (el) buttons.current.set(d.day, el);
                  else buttons.current.delete(d.day);
                }}
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(d.day)}
                className="cute-press flex min-h-touch min-w-[4.4rem] flex-1 flex-col items-center px-0.5 pb-2"
              >
                <span
                  className={`relative z-[1] mt-1 h-3.5 w-3.5 rounded-full border-[2.5px] border-ink transition-colors ${
                    active ? 'bg-sakura-500' : 'bg-white'
                  }`}
                  aria-hidden
                />
                <span
                  className={`mt-1.5 rounded-full border-2 px-2 text-sm font-bold leading-6 tracking-wide transition-colors ${
                    active ? 'border-ink bg-sakura-500 text-ink shadow-sticker-sm' : 'border-transparent text-ink'
                  }`}
                >
                  {d.date.slice(5).replace('-', '/')}
                </span>
                <span
                  className={`mt-0.5 max-w-[5.5rem] truncate text-xs font-semibold ${
                    active ? 'text-ink' : 'text-slate-500'
                  }`}
                >
                  {displayDayLabel(locale, d.label)}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
