/**
 * Public read-only itinerary.
 * Builds a new object from an allow-list. Does not copy the trip and then delete fields.
 */

function text(value) {
  return typeof value === 'string' ? value : '';
}

function point(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function copyLodging(lodging) {
  const source = lodging && typeof lodging === 'object' && !Array.isArray(lodging) ? lodging : {};
  return {
    name: text(source.name),
    address: text(source.address),
    lat: point(source.lat),
    lng: point(source.lng),
  };
}

function copyDay(day) {
  if (!day || typeof day !== 'object' || Array.isArray(day)) return null;
  if (typeof day.day !== 'number' || !Number.isFinite(day.day)) return null;
  return {
    day: day.day,
    date: text(day.date),
    label: text(day.label),
  };
}

function copyStop(stop) {
  if (!stop || typeof stop !== 'object' || Array.isArray(stop)) return null;
  if (typeof stop.id !== 'string' || !stop.id) return null;
  return {
    id: stop.id,
    day: typeof stop.day === 'number' && Number.isFinite(stop.day) ? stop.day : 0,
    date: text(stop.date),
    title: text(stop.title),
    time: text(stop.time),
    notes: text(stop.notes),
    lat: point(stop.lat),
    lng: point(stop.lng),
  };
}

export function toPublicShare(state) {
  const days = Array.isArray(state?.days) ? state.days.flatMap((day) => {
    const copy = copyDay(day);
    return copy ? [copy] : [];
  }) : [];
  const stops = Array.isArray(state?.stops) ? state.stops.flatMap((stop) => {
    const copy = copyStop(stop);
    return copy ? [copy] : [];
  }) : [];
  return {
    tripName: text(state?.tripName),
    lodging: copyLodging(state?.lodging),
    days,
    stops,
  };
}
