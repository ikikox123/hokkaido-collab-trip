import { stripLegEstimates } from './legs.js';

/** Display names are short labels; reject rather than silently truncate. */
export const STOP_TITLE_MAX = 80;

export function normalizeStopTitle(value) {
  if (typeof value !== 'string') return { ok: false, error: '地點名稱不可空白' };
  const title = value.trim();
  if (!title) return { ok: false, error: '地點名稱不可空白' };
  if (title.length > STOP_TITLE_MAX) return { ok: false, error: '地點名稱過長' };
  return { ok: true, title };
}

/**
 * Change only `title`. Coordinates, notes, and the legs array stay as they are.
 */
export function renameStop(state, id, rawTitle) {
  const normalized = normalizeStopTitle(rawTitle);
  if (!normalized.ok) return { ok: false, error: normalized.error };
  const stops = state?.stops || [];
  const index = stops.findIndex((stop) => stop.id === id);
  if (index < 0) return { ok: false, error: '找不到站點' };
  if (stops[index].title === normalized.title) {
    return { ok: true, unchanged: true, titleOnly: true, state };
  }
  const nextStops = stops.slice();
  nextStops[index] = { ...stops[index], title: normalized.title };
  return {
    ok: true,
    unchanged: false,
    titleOnly: true,
    state: { ...state, stops: nextStops, legs: state.legs },
  };
}

/**
 * Apply a stop patch.
 * A patch that only sets `title` renames the stop and does not touch coordinates or legs.
 * Patches that also move lat/lng still drop route estimates, matching other place edits.
 */
export function applyStopPatch(state, id, patch) {
  const safe = patch && typeof patch === 'object' && !Array.isArray(patch) ? { ...patch } : {};
  delete safe.id;
  const hasTitle = Object.prototype.hasOwnProperty.call(safe, 'title');
  const otherKeys = Object.keys(safe).filter((key) => key !== 'title');

  if (hasTitle && otherKeys.length === 0) {
    return renameStop(state, id, safe.title);
  }

  if (hasTitle) {
    const normalized = normalizeStopTitle(safe.title);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    safe.title = normalized.title;
  }

  const exists = (state?.stops || []).some((stop) => stop.id === id);
  if (!exists) return { ok: false, error: '找不到站點' };

  let legs = state.legs;
  if (safe.lat != null || safe.lng != null) {
    legs = stripLegEstimates(legs, id);
  }
  const stops = state.stops.map((stop) => (stop.id === id ? { ...stop, ...safe, id: stop.id } : stop));
  return {
    ok: true,
    unchanged: false,
    titleOnly: false,
    state: { ...state, legs, stops },
  };
}
