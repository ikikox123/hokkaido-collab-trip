/**
 * Travel legs between consecutive stops of the same day (list order).
 *
 * Transit modes (subway / jr / bus) use OSRM driving geometry for the path,
 * but duration is a speed estimate — 估算非時刻表, not a timetable:
 *   地鐵 28 km/h + 3 分鐘進出站
 *   JR   50 km/h + 4 分鐘
 *   巴士 18 km/h + 3 分鐘
 * walk uses the OSRM walking profile; taxi / car / charter use driving duration.
 */

export const TRAVEL_MODES = ['walk', 'subway', 'jr', 'bus', 'taxi', 'car', 'charter'];

export const MODE_META = {
  walk: { profile: 'walking', label: '步行', transit: false },
  subway: { profile: 'driving', label: '地鐵', transit: true, speedMps: 28000 / 3600, padSec: 180 },
  jr: { profile: 'driving', label: 'JR', transit: true, speedMps: 50000 / 3600, padSec: 240 },
  bus: { profile: 'driving', label: '巴士', transit: true, speedMps: 18000 / 3600, padSec: 180 },
  taxi: { profile: 'driving', label: '計程車', transit: false },
  car: { profile: 'driving', label: '自駕', transit: false },
  charter: { profile: 'driving', label: '包車', transit: false },
};

/** Demo defaults. Day 2 Sapporo city is mostly subway + short walks. */
export const PRESET_MODES = {
  's1>s2': 'jr',
  's2>s3': 'subway',
  's3>s4': 'walk',
  's4>s5': 'walk',
  's5>s6': 'walk',
  's7>s8': 'walk',
  's8>s9': 'walk',
  's9>s10': 'subway',
  's10>s11': 'subway',
  's11>s12': 'subway',
  's12>s13': 'subway',
  's13>s14': 'walk',
  's15>s16': 'charter',
  's16>s17': 'charter',
  's17>s18': 'charter',
  's18>s19': 'charter',
  's21>s22': 'walk',
  's22>s23': 'walk',
  's23>s24': 'walk',
  's24>s25': 'walk',
  's26>s27': 'walk',
  's28>s29': 'jr',
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const routeCache = new Map();

export function legId(fromStopId, toStopId) {
  return `leg_${fromStopId}_${toStopId}`;
}

export function haversineMeters(a, b) {
  const R = 6371000;
  const φ1 = (a.lat * Math.PI) / 180;
  const φ2 = (b.lat * Math.PI) / 180;
  const dφ = ((b.lat - a.lat) * Math.PI) / 180;
  const dλ = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function defaultMode(from, to) {
  const preset = PRESET_MODES[`${from.id}>${to.id}`];
  if (preset) return preset;
  if (from.day === 3 && to.day === 3) return 'charter';
  const d = haversineMeters(from, to);
  if (d < 900) return 'walk';
  if (d < 15000) return 'subway';
  if (d < 80000) return 'jr';
  return 'car';
}

export function formatDuration(sec) {
  const min = Math.max(1, Math.round(Math.max(0, sec) / 60));
  if (min < 60) return `${min} 分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小時 ${m} 分` : `${h} 小時`;
}

export function formatDistance(meters) {
  const m = Math.max(0, meters);
  if (m < 50) return '很近';
  if (m < 1000) return `${Math.round(m)} m`;
  const km = m / 1000;
  return `${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km`;
}

export function buildSummary(mode, durationSec, distanceM, { straight = false } = {}) {
  const meta = MODE_META[mode] || MODE_META.walk;
  const time = formatDuration(durationSec);
  const dist = formatDistance(distanceM);
  const advice = meta.label === 'JR' ? '建議 JR' : `建議${meta.label}`;
  const head = meta.transit
    ? `約 ${time}・${dist}・${advice}（估算非時刻表）`
    : `約 ${time}・${dist}・${meta.label}`;
  return straight ? `${head}（直線估算）` : head;
}

/** Apply mode-specific duration. Transit ignores OSRM's driving duration. */
export function estimateFromRoute(mode, distanceM, osrmDurationSec) {
  const meta = MODE_META[mode] || MODE_META.walk;
  const distance = Math.max(0, Math.round(distanceM));
  let durationSec;
  if (meta.transit) {
    durationSec = Math.max(60, Math.round(distance / meta.speedMps + meta.padSec));
  } else if (osrmDurationSec != null && Number.isFinite(osrmDurationSec)) {
    durationSec = Math.max(60, Math.round(osrmDurationSec));
  } else if (mode === 'walk') {
    durationSec = Math.max(60, Math.round(distance / 1.25));
  } else {
    durationSec = Math.max(60, Math.round(distance / 8.3));
  }
  return { distanceM: distance, durationSec };
}

function dayList(state) {
  const days = Array.isArray(state.days) ? [...state.days] : [];
  const seen = new Set(days.map((d) => d.day));
  for (const stop of state.stops || []) {
    if (!seen.has(stop.day)) {
      seen.add(stop.day);
      days.push({ day: stop.day });
    }
  }
  return days;
}

export function reconcileLegs(state) {
  const existing = new Map();
  for (const leg of state.legs || []) {
    if (!leg?.fromStopId || !leg?.toStopId) continue;
    existing.set(`${leg.fromStopId}>${leg.toStopId}`, leg);
  }
  const legs = [];
  for (const day of dayList(state)) {
    const stops = (state.stops || []).filter((s) => s.day === day.day);
    for (let i = 0; i < stops.length - 1; i++) {
      const from = stops[i];
      const to = stops[i + 1];
      const prev = existing.get(`${from.id}>${to.id}`);
      const mode = prev && TRAVEL_MODES.includes(prev.mode) ? prev.mode : defaultMode(from, to);
      const keepEstimate =
        prev &&
        prev.mode === mode &&
        prev.distanceM != null &&
        prev.summary &&
        Array.isArray(prev.geometry) &&
        prev.geometry.length >= 2;
      legs.push({
        id: prev?.id || legId(from.id, to.id),
        fromStopId: from.id,
        toStopId: to.id,
        mode,
        ...(keepEstimate
          ? {
              distanceM: prev.distanceM,
              durationSec: prev.durationSec,
              summary: prev.summary,
              geometry: prev.geometry,
            }
          : {}),
      });
    }
  }
  return legs;
}

export function setLegMode(state, fromStopId, toStopId, mode) {
  if (!TRAVEL_MODES.includes(mode)) return { state, changed: false };
  const legs = reconcileLegs(state).map((leg) => {
    if (leg.fromStopId !== fromStopId || leg.toStopId !== toStopId) return leg;
    if (leg.mode === mode) return leg;
    return { id: leg.id, fromStopId, toStopId, mode };
  });
  if (!legs.some((l) => l.fromStopId === fromStopId && l.toStopId === toStopId)) {
    return { state, changed: false };
  }
  return { state: { ...state, legs }, changed: true };
}

export function stripLegEstimates(legs, stopId) {
  return (legs || []).map((leg) => {
    if (leg.fromStopId !== stopId && leg.toStopId !== stopId) return leg;
    return {
      id: leg.id,
      fromStopId: leg.fromStopId,
      toStopId: leg.toStopId,
      mode: leg.mode,
    };
  });
}

function cacheGet(key) {
  const hit = routeCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) {
    routeCache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  routeCache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  if (routeCache.size > 300) {
    const oldest = routeCache.keys().next().value;
    routeCache.delete(oldest);
  }
}

export function osrmBaseUrl() {
  return (process.env.OSRM_BASE_URL || 'https://router.project-osrm.org').replace(/\/$/, '');
}

export async function fetchOsrmRoute(profile, from, to) {
  const key = [
    profile,
    Number(from.lng).toFixed(5),
    Number(from.lat).toFixed(5),
    Number(to.lng).toFixed(5),
    Number(to.lat).toFixed(5),
  ].join(':');
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const url =
    `${osrmBaseUrl()}/route/v1/${profile}/` +
    `${Number(from.lng)},${Number(from.lat)};${Number(to.lng)},${Number(to.lat)}` +
    '?overview=full&geometries=geojson';
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'hokkaido-collab-trip/1.0',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== 'Ok' || !data.routes?.[0]) {
    throw new Error(data.message || data.code || 'OSRM 無路線');
  }
  const route = data.routes[0];
  const value = {
    distance: Number(route.distance) || 0,
    duration: Number(route.duration) || 0,
    coordinates: Array.isArray(route.geometry?.coordinates) ? route.geometry.coordinates : [],
  };
  cacheSet(key, value);
  return value;
}

function toLatLngGeometry(coordinates) {
  if (!coordinates?.length) return undefined;
  const pts = [];
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    pts.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
  }
  return pts.length >= 2 ? pts : undefined;
}

export async function computeLegRoute(from, to, mode) {
  const safeMode = MODE_META[mode] ? mode : 'walk';
  try {
    const osrm = await fetchOsrmRoute(MODE_META[safeMode].profile, from, to);
    const est = estimateFromRoute(safeMode, osrm.distance, osrm.duration);
    const geometry = toLatLngGeometry(osrm.coordinates) || [
      [from.lat, from.lng],
      [to.lat, to.lng],
    ];
    return {
      mode: safeMode,
      ...est,
      geometry,
      summary: buildSummary(safeMode, est.durationSec, est.distanceM),
      source: 'osrm',
    };
  } catch (err) {
    const factor = safeMode === 'walk' ? 1.2 : 1.35;
    const distanceM = haversineMeters(from, to) * factor;
    const est = estimateFromRoute(safeMode, distanceM, null);
    return {
      mode: safeMode,
      ...est,
      geometry: [
        [from.lat, from.lng],
        [to.lat, to.lng],
      ],
      summary: buildSummary(safeMode, est.durationSec, est.distanceM, { straight: true }),
      source: 'fallback',
    };
  }
}

export function estimateFields(result) {
  return {
    distanceM: result.distanceM,
    durationSec: result.durationSec,
    summary: result.summary,
    geometry: result.geometry,
  };
}

export function normalizeTripState(state) {
  if (!state || !Array.isArray(state.stops)) return state;
  return { ...state, legs: reconcileLegs(state) };
}
