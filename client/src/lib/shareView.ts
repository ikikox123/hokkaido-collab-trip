import { displayDayLabel } from '../i18n/screen.ts';
import { displayStopTitle } from '../i18n/stopNames.ts';
import { intlLocale, type Locale } from '../i18n/messages.ts';
import { SAPPORO_BASE, type LodgingPoint } from './dayView.ts';
import { stopNumberById } from './stopNumbers.ts';
import type { ShareScope } from './sharePath.ts';

/**
 * Display model for the read-only sheet.
 * Stored titles, notes, day suffixes, lodging name, and address are not rewritten.
 */
export type ShareStop = {
  id: string;
  day: number;
  date: string;
  title: string;
  time: string;
  notes?: string;
};

export type ShareDay = {
  day: number;
  date: string;
  label: string;
};

export type ShareLodging = {
  name?: string;
  address?: string;
  lat?: number;
  lng?: number;
} | null;

export type ShareTrip = {
  tripName?: string;
  lodging?: ShareLodging;
  days: ShareDay[];
  stops: ShareStop[];
};

export type ShareLodgingDisplay = {
  name: string;
  address: string;
  point: LodgingPoint;
  usedBaseFallback: boolean;
};

export function shareLodgingDisplay(lodging: ShareLodging | undefined): ShareLodgingDisplay {
  const name = typeof lodging?.name === 'string' ? lodging.name : '';
  const address = typeof lodging?.address === 'string' ? lodging.address : '';
  const lat = lodging?.lat;
  const lng = lodging?.lng;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return { name, address, point: { lat, lng }, usedBaseFallback: false };
  }
  return {
    name,
    address,
    point: { lat: SAPPORO_BASE.lat, lng: SAPPORO_BASE.lng },
    usedBaseFallback: true,
  };
}

export function formatLodgingPoint(point: LodgingPoint) {
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

/** Stored calendar date, plus a weekday from the active locale. The ISO date itself is not rewritten. */
export function formatShareDate(locale: Locale, iso: string) {
  if (typeof iso !== 'string') return '';
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const weekday = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short', timeZone: 'UTC' }).format(date);
  return `${iso} ${weekday}`;
}

export function shareDayHeading(locale: Locale, day: ShareDay) {
  const label = typeof day.label === 'string' ? day.label : '';
  const date = typeof day.date === 'string' ? day.date : '';
  return {
    title: displayDayLabel(locale, label),
    dateLabel: formatShareDate(locale, date),
  };
}

export function shareStopDisplay(locale: Locale, stop: ShareStop, number: number) {
  return {
    number,
    time: stop.time,
    title: displayStopTitle(locale, stop.title),
    notes: typeof stop.notes === 'string' ? stop.notes : '',
  };
}

export type ShareDayBlock = {
  day: ShareDay;
  stops: Array<{ stop: ShareStop; number: number }>;
};

export function shareDays(trip: ShareTrip, scope: ShareScope): { days: ShareDayBlock[]; unknownDay: boolean } {
  const numbers = stopNumberById(trip.stops);
  const byDay = new Map<number, ShareStop[]>();
  for (const stop of trip.stops) {
    const list = byDay.get(stop.day) ?? [];
    list.push(stop);
    byDay.set(stop.day, list);
  }
  const unknownDay = scope.kind === 'day' && !trip.days.some((day) => day.day === scope.day);
  const wanted =
    scope.kind === 'all' ? trip.days : trip.days.filter((day) => day.day === scope.day);
  return {
    unknownDay,
    days: wanted.map((day) => ({
      day,
      stops: (byDay.get(day.day) ?? []).flatMap((stop) => {
        const number = numbers.get(stop.id);
        if (number == null) return [];
        return [{ stop, number }];
      }),
    })),
  };
}

/** Text after the first fullwidth bar, matching the collaborative header. Not translated. */
export function shareTripSubtitle(tripName: string | undefined) {
  if (!tripName || !tripName.includes('｜')) return '';
  return tripName.split('｜').slice(1).join('｜');
}

export function isShareTrip(value: unknown): value is ShareTrip {
  if (!value || typeof value !== 'object') return false;
  const trip = value as Partial<ShareTrip>;
  return Array.isArray(trip.days) && Array.isArray(trip.stops);
}
