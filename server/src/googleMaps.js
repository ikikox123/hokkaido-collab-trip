/**
 * Server-side Google Maps calls: Directions, Find Place, Geocoding.
 * The key is read from GOOGLE_MAPS_SERVER_KEY and is never logged.
 */

const HOKKAIDO = { minLat: 41.2, maxLat: 45.7, minLng: 139.2, maxLng: 146.2 };

export function serverMapsKey() {
  const key = String(process.env.GOOGLE_MAPS_SERVER_KEY || '').trim();
  return key || null;
}

export function redactSecrets(text, key = serverMapsKey()) {
  let out = String(text ?? '');
  if (key) out = out.split(key).join('[redacted]');
  return out.replace(/key=[^&\s]+/gi, 'key=[redacted]');
}

/** walk → walking, taxi/car/charter → driving, subway/jr/bus → transit. */
export function directionsProfile(mode) {
  if (mode === 'walk') return { travelMode: 'walking', transitMode: null };
  if (mode === 'subway') return { travelMode: 'transit', transitMode: 'subway' };
  if (mode === 'jr') return { travelMode: 'transit', transitMode: 'rail' };
  if (mode === 'bus') return { travelMode: 'transit', transitMode: 'bus' };
  if (mode === 'taxi' || mode === 'car' || mode === 'charter') {
    return { travelMode: 'driving', transitMode: null };
  }
  return { travelMode: 'walking', transitMode: null };
}

export function inHokkaido(lat, lng) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= HOKKAIDO.minLat &&
    lat <= HOKKAIDO.maxLat &&
    lng >= HOKKAIDO.minLng &&
    lng <= HOKKAIDO.maxLng
  );
}

export function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

/** Google encoded polyline → [lat, lng][]. */
export function decodePolyline(encoded) {
  if (!encoded || typeof encoded !== 'string') return [];
  const pts = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      if (index >= encoded.length) return pts;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;
    result = 0;
    shift = 0;
    do {
      if (index >= encoded.length) return pts;
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;
    pts.push([round6(lat / 1e5), round6(lng / 1e5)]);
  }
  return pts;
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const prev = out[out.length - 1];
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    out.push(p);
  }
  return out;
}

export function geometryFromRoute(route) {
  const steps = route?.legs?.[0]?.steps || [];
  const fromSteps = [];
  for (const step of steps) {
    fromSteps.push(...decodePolyline(step?.polyline?.points));
  }
  const detailed = dedupe(fromSteps);
  if (detailed.length >= 2) return detailed;
  const overview = dedupe(decodePolyline(route?.overview_polyline?.points));
  return overview.length >= 2 ? overview : [];
}

function safeStatus(data, key) {
  const status = data?.status || 'UNKNOWN';
  let msg = String(data?.error_message || '');
  msg = redactSecrets(msg, key).slice(0, 180);
  return msg ? `${status}: ${msg}` : status;
}

async function googleGet(url, key) {
  let res;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    throw new Error(redactSecrets(err?.message || 'Google request failed', key));
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Google HTTP ${res.status}`);
  }
  return data;
}

function directionsUrl(from, to, travelMode, transitMode, key) {
  const url = new URL('https://maps.googleapis.com/maps/api/directions/json');
  url.searchParams.set('origin', `${from.lat},${from.lng}`);
  url.searchParams.set('destination', `${to.lat},${to.lng}`);
  url.searchParams.set('mode', travelMode);
  url.searchParams.set('region', 'jp');
  url.searchParams.set('language', 'ja');
  if (travelMode === 'transit') {
    url.searchParams.set('departure_time', String(Math.floor(Date.now() / 1000)));
    if (transitMode) url.searchParams.set('transit_mode', transitMode);
  }
  url.searchParams.set('key', key);
  return url;
}

async function requestDirections(from, to, travelMode, transitMode, key) {
  const data = await googleGet(directionsUrl(from, to, travelMode, transitMode, key), key);
  if (data.status !== 'OK' || !data.routes?.[0]?.legs?.[0]) {
    throw new Error(safeStatus(data, key));
  }
  const leg = data.routes[0].legs[0];
  const distanceM = Number(leg.distance?.value);
  const durationSec = Number(leg.duration?.value);
  if (!Number.isFinite(distanceM) || !Number.isFinite(durationSec)) {
    throw new Error('Google Directions 沒有距離或時間');
  }
  const geometry = geometryFromRoute(data.routes[0]);
  return {
    distanceM: Math.max(0, Math.round(distanceM)),
    durationSec: Math.max(60, Math.round(durationSec)),
    geometry:
      geometry.length >= 2
        ? geometry
        : [
            [round6(from.lat), round6(from.lng)],
            [round6(to.lat), round6(to.lng)],
          ],
  };
}

/**
 * One leg via Directions.
 * Transit tries the specific transit_mode, then any transit, then driving
 * marked as a driving-path estimate.
 */
export async function fetchGoogleDirections(from, to, mode, key) {
  const profile = directionsProfile(mode);
  if (profile.travelMode !== 'transit') {
    const route = await requestDirections(from, to, profile.travelMode, null, key);
    return { ...route, liveTransit: false, drivingFallback: false, approximate: false };
  }
  try {
    const route = await requestDirections(from, to, 'transit', profile.transitMode, key);
    return { ...route, liveTransit: true, drivingFallback: false, approximate: false };
  } catch {
    try {
      const route = await requestDirections(from, to, 'transit', null, key);
      return { ...route, liveTransit: true, drivingFallback: false, approximate: false };
    } catch {
      const route = await requestDirections(from, to, 'driving', null, key);
      return { ...route, liveTransit: false, drivingFallback: true, approximate: true };
    }
  }
}

function placeFromCandidate(candidate) {
  const lat = Number(candidate?.geometry?.location?.lat);
  const lng = Number(candidate?.geometry?.location?.lng);
  if (!inHokkaido(lat, lng)) return null;
  return {
    name: String(candidate.name || candidate.formatted_address || '').slice(0, 120),
    address: String(candidate.formatted_address || '').slice(0, 180),
    lat: round6(lat),
    lng: round6(lng),
  };
}

export async function findPlace(query, key, { bias } = {}) {
  const input = String(query || '').trim().slice(0, 160);
  if (!input) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/place/findplacefromtext/json');
  url.searchParams.set('input', input);
  url.searchParams.set('inputtype', 'textquery');
  url.searchParams.set('fields', 'geometry,name,formatted_address');
  url.searchParams.set('language', 'ja');
  if (bias) url.searchParams.set('locationbias', bias);
  url.searchParams.set('key', key);
  const data = await googleGet(url, key);
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') throw new Error(safeStatus(data, key));
  return placeFromCandidate(data.candidates?.[0]);
}

export async function geocodeAddress(query, key) {
  const address = String(query || '').trim().slice(0, 160);
  if (!address) return null;
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', address);
  url.searchParams.set('region', 'jp');
  url.searchParams.set('language', 'ja');
  url.searchParams.set('components', 'country:JP');
  url.searchParams.set('key', key);
  const data = await googleGet(url, key);
  if (data.status === 'ZERO_RESULTS') return null;
  if (data.status !== 'OK') throw new Error(safeStatus(data, key));
  const result = data.results?.[0];
  if (!result) return null;
  return placeFromCandidate({
    name: result.formatted_address,
    formatted_address: result.formatted_address,
    geometry: result.geometry,
  });
}

/** Places Find Place, then Geocoding if Find Place misses. */
export async function lookupPlace(query, key, options = {}) {
  const found = await findPlace(query, key, options);
  if (found) return { ...found, source: 'places' };
  const geo = await geocodeAddress(query, key);
  if (geo) return { ...geo, source: 'geocode' };
  return null;
}
