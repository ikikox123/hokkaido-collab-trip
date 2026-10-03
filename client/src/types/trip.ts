import type { FxView } from '../../../server/src/fx.js';
import type { BillMember, Expense } from '../../../server/src/split.js';

export type {
  BillMember,
  Currency,
  Expense,
  ExpensePart,
  ExpenseShare,
  SplitMode,
} from '../../../server/src/split.js';

export type DayInfo = {
  day: number;
  date: string;
  label: string;
};

export type Stop = {
  id: string;
  day: number;
  date: string;
  title: string;
  time: string;
  lat: number;
  lng: number;
  notes: string;
};

export type TravelMode = 'walk' | 'subway' | 'jr' | 'bus' | 'taxi' | 'car' | 'charter';

/** One hop between adjacent stops of the same day, in list order. */
export type Leg = {
  id: string;
  fromStopId: string;
  toStopId: string;
  mode: TravelMode;
  distanceM?: number;
  durationSec?: number;
  /** Traditional Chinese estimate, e.g. 約 25 分・3.2 km・建議地鐵（估算非時刻表） */
  summary?: string;
  /** [lat, lng] polyline. */
  geometry?: [number, number][];
  /** Driving-path stand-in when transit directions were unavailable. */
  approximate?: boolean;
};

export type TripState = {
  roomCode: string;
  tripName: string;
  lodging: { name: string; address: string; lat: number; lng: number };
  flights: { outbound: string; inbound: string };
  days: DayInfo[];
  stops: Stop[];
  legs?: Leg[];
  members?: BillMember[];
  expenses?: Expense[];
  fx?: FxView;
  updatedAt: string;
};

export type User = {
  id: string;
  username: string;
  displayName: string;
};

export type WeatherCity = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  temperature: number | null;
  weatherCode: number | null;
  time: string | null;
};

export type PresenceUser = {
  socketId: string;
  userId: string | null;
  displayName: string;
  username: string | null;
};
