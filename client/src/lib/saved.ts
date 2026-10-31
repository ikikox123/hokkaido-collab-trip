/**
 * Saved places client. Every call resolves to `null` when the server has no such API
 * (the Express server answers with the app shell, not JSON), so the UI can quietly hide itself.
 */

export type PlaceType = 'eat' | 'sight' | 'stay' | 'shop';
export type SavedScope = 'mine' | 'shared';

export type SavedPlace = {
  id: string;
  scope: 'personal' | 'shared';
  name: string;
  type: PlaceType | null;
  country: string;
  city: string;
  district: string;
  address: string;
  lat: number | null;
  lng: number | null;
  /** 'place' = exact spot, 'area' = only the district/city centre; absent on older servers. */
  precision?: 'place' | 'area' | null;
  status: 'ready' | 'pending';
  confidence: number;
  sourceUrl: string | null;
  mapsUrl: string;
  hasText: boolean;
  addedBy?: string | null;
  mine?: boolean;
  createdAt: string;
  updatedAt: string;
};

export type KeyInfo = { hasKey: boolean; createdAt: string | null };

export type SavedResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function call<T>(token: string, method: string, path: string, body?: unknown): Promise<SavedResult<T> | null> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, error: '連線失敗，請稍後再試', status: 0 };
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) return null; // no saved-places API on this server
  let data: unknown = {};
  try {
    data = await res.json();
  } catch {
    return null;
  }
  if (!res.ok) {
    const error = (data as { error?: string }).error || '操作失敗，請稍後再試';
    return res.status === 404 && error === 'Not found' ? null : { ok: false, error, status: res.status };
  }
  return { ok: true, data: data as T };
}

/** True when this server has the API and the login works. Used once to decide whether to show the feature. */
export async function probeSaved(token: string): Promise<boolean> {
  const result = await call<KeyInfo>(token, 'GET', '/api/saved/key');
  return Boolean(result && result.ok);
}

export const getKeyInfo = (token: string) => call<KeyInfo>(token, 'GET', '/api/saved/key');
export const createKey = (token: string) => call<KeyInfo & { key: string }>(token, 'POST', '/api/saved/key');
export const revokeKey = (token: string) => call<KeyInfo>(token, 'DELETE', '/api/saved/key');
export const listSaved = (token: string, scope: SavedScope) =>
  call<{ places: SavedPlace[] }>(token, 'GET', `/api/saved?scope=${scope}`);
export const deleteSaved = (token: string, id: string) => call<{ ok: true }>(token, 'DELETE', `/api/saved/${id}`);
export const shareSaved = (token: string, id: string) =>
  call<{ place: SavedPlace; already: boolean }>(token, 'POST', `/api/saved/${id}/share`);
export const reextractSaved = (token: string, id: string, text?: string) =>
  call<{ place: SavedPlace }>(token, 'POST', `/api/saved/${id}/reextract`, text ? { text } : {});
export const patchSaved = (
  token: string,
  id: string,
  patch: Partial<Pick<SavedPlace, 'name' | 'type' | 'country' | 'city' | 'district'>>,
) => call<{ place: SavedPlace }>(token, 'PATCH', `/api/saved/${id}`, patch);

export type PlaceGroup = { key: string; label: string | null; places: SavedPlace[] };

/**
 * Group by district (falling back to city, then "no area"). Groups keep the order of their
 * newest place; the no-area group is last. Places inside a group keep the server's order.
 */
export function groupByDistrict(places: SavedPlace[]): PlaceGroup[] {
  const groups = new Map<string, PlaceGroup>();
  for (const place of places) {
    const label = place.district.trim() || place.city.trim() || null;
    const key = label ?? '';
    const group = groups.get(key) ?? { key, label, places: [] };
    group.places.push(place);
    groups.set(key, group);
  }
  const list = [...groups.values()];
  return [...list.filter((g) => g.label), ...list.filter((g) => !g.label)];
}

const NOISE_PART = /^(?:\d{3}-?\d{4}|日本|japan|北海道|.+振興局|.+地方)$/i;

/** Short place from an OSM display_name: drops postcode, subprefecture, region and country; at most two parts. */
export function shortAddress(address: string): string {
  const parts = address.split(/[,、，]/).map((v) => v.trim()).filter((v) => v && !NOISE_PART.test(v));
  return parts.slice(0, 2).join('・');
}

/** "札幌・中央区", skipping empty parts. */
export function areaLine(place: Pick<SavedPlace, 'country' | 'city' | 'district'>): string {
  return [place.city, place.district].map((v) => v.trim()).filter(Boolean).join('・');
}

export type StopFromSaved = {
  title: string;
  lat: number;
  lng: number;
  notes: string;
  /** False when the place has no coordinates and the caller's fallback position was used. */
  located: boolean;
};

const NOTE_MAX = 300; // same limits as the server's stop note check (code points, 3 lines)
const chars = (text: string) => Array.from(text);

/** "12:00" style time one hour after the last stop of the day; 12:00 when there is none; never past 23:00. */
export function nextStopTime(lastTime: string | null | undefined): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(lastTime ?? '').trim());
  if (!match) return '12:00';
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  if (Number(match[1]) > 23 || Number(match[2]) > 59) return '12:00';
  const next = Math.min(minutes + 60, 23 * 60);
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}

/**
 * Stop fields for trip:add. Without coordinates the fallback position is used (the card says so).
 * Notes: "(pending) type・where" then the map link on its own line. The link is never cut: if it
 * does not fit it is left out and only the text is trimmed.
 */
export function stopFromSaved(
  place: SavedPlace,
  fallback: { lat: number; lng: number },
  typeLabel: string | null,
  pendingLabel = '（待確認位置）',
): StopFromSaved {
  const located = place.lat != null && place.lng != null;
  const exact = located && place.precision !== 'area' && place.status !== 'pending';
  const area = areaLine(place);
  // 'area' precision or no coordinates: only the district centre is known, so never show a full address.
  const where = !located || place.precision === 'area' ? area : area || shortAddress(place.address);
  const body = [typeLabel, where].filter(Boolean).join('・').replace(/\s+/g, ' ').trim();
  const head = [exact ? '' : pendingLabel, body].filter(Boolean).join('');
  const link = place.mapsUrl || '';
  let notes: string;
  if (link && chars(link).length + 1 < NOTE_MAX) {
    const room = NOTE_MAX - chars(link).length - 1;
    const text = chars(head).length > room ? chars(head).slice(0, room).join('') : head;
    notes = text ? `${text}\n${link}` : link;
  } else {
    notes = chars(head).slice(0, NOTE_MAX).join('');
  }
  return {
    title: place.name,
    lat: located ? (place.lat as number) : fallback.lat,
    lng: located ? (place.lng as number) : fallback.lng,
    notes,
    located,
  };
}

/** Opening hours from the OSM lookup for an exact place; null on any failure (never blocks adding). */
export async function lookupSavedHours(token: string, place: SavedPlace): Promise<string | null> {
  if (place.lat == null || place.lng == null || place.precision === 'area' || !place.name.trim()) return null;
  try {
    const qs = new URLSearchParams({ name: place.name, lat: String(place.lat), lng: String(place.lng) });
    const res = await fetch(`/api/opening-hours?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json().catch(() => ({}));
    return res.ok && typeof data.hours === 'string' && data.hours.trim() ? data.hours.trim() : null;
  } catch {
    return null;
  }
}
