import { stripLegEstimates } from './legs.js';
import { cleanStopInfo } from './stopInfo.js';

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

/** Fields a stop edit may change. Anything else in the patch is ignored. */
export const STOP_PATCH_KEYS = ['title', 'time', 'notes', 'hours', 'lat', 'lng'];

function whitelistStopPatch(patch) {
  const source = patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {};
  const safe = {};
  for (const key of STOP_PATCH_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (key === 'lat' || key === 'lng') {
      if (typeof value === 'number' && Number.isFinite(value)) safe[key] = value;
      continue;
    }
    if (key === 'hours' || key === 'notes') {
      // Strings are cleaned later; null clears the field.
      if (typeof value === 'string' || value === null) safe[key] = value;
      continue;
    }
    if (typeof value === 'string') safe[key] = value;
  }
  return safe;
}

/**
 * Apply a stop patch.
 * A patch that only sets `title` renames the stop and does not touch coordinates or legs.
 * Patches that also move lat/lng still drop route estimates, matching other place edits.
 * Only title, time, notes, hours, lat, and lng are copied onto the stop.
 */
export function applyStopPatch(state, id, patch) {
  const safe = whitelistStopPatch(patch);
  if (typeof safe.lat === 'number' && Math.abs(safe.lat) > 90) {
    return { ok: false, error: '座標超出範圍' };
  }
  if (typeof safe.lng === 'number' && Math.abs(safe.lng) > 180) {
    return { ok: false, error: '座標超出範圍' };
  }
  const info = cleanStopInfo(safe);
  if (!info.ok) return { ok: false, error: info.error };
  delete safe.hours;
  delete safe.notes;
  const hasInfo = info.remove.length > 0 || Object.keys(info.set).length > 0;
  const hasTitle = Object.prototype.hasOwnProperty.call(safe, 'title');
  const otherKeys = Object.keys(safe).filter((key) => key !== 'title');
  if (!hasTitle && otherKeys.length === 0 && !hasInfo) {
    return { ok: true, unchanged: true, titleOnly: true, state };
  }

  if (hasTitle && otherKeys.length === 0 && !hasInfo) {
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
  const before = state.stops.find((stop) => stop.id === id);
  const next = { ...before, ...safe, id: before.id, ...info.set };
  for (const key of info.remove) delete next[key];
  // Absent and '' both mean "no value", so clearing a legacy empty note is not a change.
  const same = Object.keys({ ...before, ...next }).every((key) => (before[key] ?? '') === (next[key] ?? ''));
  if (same) return { ok: true, unchanged: true, titleOnly: !otherKeys.length, state };
  const stops = state.stops.map((stop) => (stop.id === id ? next : stop));
  // Text-only edits (name, hours, note) never move a stop, so routes are left alone.
  const textOnly = !otherKeys.length;
  return {
    ok: true,
    unchanged: false,
    titleOnly: textOnly,
    state: { ...state, legs, stops },
  };
}
