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
  status: 'ready' | 'pending';
  confidence: number;
  sourceUrl: string | null;
  mapsUrl: string;
  hasText: boolean;
  addedBy?: string | null;
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

/** Stop fields for trip:add. Without coordinates the fallback position is used (the card says so). */
export function stopFromSaved(
  place: SavedPlace,
  fallback: { lat: number; lng: number },
  typeLabel: string | null,
): StopFromSaved {
  const located = place.lat != null && place.lng != null;
  const where = place.address || areaLine(place);
  const notes = [typeLabel, where].filter(Boolean).join('・').slice(0, 300);
  return {
    title: place.name,
    lat: located ? (place.lat as number) : fallback.lat,
    lng: located ? (place.lng as number) : fallback.lng,
    notes,
    located,
  };
}

