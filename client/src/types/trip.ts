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

export type TripState = {
  roomCode: string;
  tripName: string;
  lodging: { name: string; address: string; lat: number; lng: number };
  flights: { outbound: string; inbound: string };
  days: DayInfo[];
  stops: Stop[];
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
