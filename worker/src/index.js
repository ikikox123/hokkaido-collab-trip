import { TRAVEL_MODES, computeLegRoute } from '../../server/src/legs.js';
import { serverMapsKey } from '../../server/src/googleMaps.js';
import { getWeather } from '../../server/src/weather.js';
import { getTripAlerts } from '../../server/src/tripAlerts.js';
import { checkSources } from './sources.js';

export { TripHub } from './tripHub.js';

/** Endpoints that need the trip, accounts, or sockets go to the single TripHub. */
function hub(env) {
  return env.TRIP_HUB.get(env.TRIP_HUB.idFromName('main'));
}

async function routeEstimate(url) {
  const q = url.searchParams;
  const fromLat = Number(q.get('fromLat'));
  const fromLng = Number(q.get('fromLng'));
  const toLat = Number(q.get('toLat'));
  const toLng = Number(q.get('toLng'));
  const mode = String(q.get('mode') || 'walk');
  if (![fromLat, fromLng, toLat, toLng].every((n) => Number.isFinite(n))) {
    return Response.json({ error: '座標不完整' }, { status: 400 });
  }
  if (Math.abs(fromLat) > 90 || Math.abs(toLat) > 90 || Math.abs(fromLng) > 180 || Math.abs(toLng) > 180) {
    return Response.json({ error: '座標超出範圍' }, { status: 400 });
  }
  if (!TRAVEL_MODES.includes(mode)) return Response.json({ error: '交通方式不正確' }, { status: 400 });
  return Response.json(await computeLegRoute({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng }, mode));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (pathname === '/ws') return hub(env).fetch(request);
    if (!pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    if (request.method === 'GET') {
      switch (pathname) {
        case '/api/health':
          return Response.json({ ok: true, runtime: 'workers', routing: serverMapsKey() ? 'google' : 'osrm' });
        case '/api/weather': {
          const result = await getWeather();
          return Response.json(result.body, { status: result.status });
        }
        case '/api/trip-alerts':
          return Response.json(await getTripAlerts());
        case '/api/route':
          return routeEstimate(url);
        case '/api/sources':
          return Response.json(await checkSources());
      }
    }
    return hub(env).fetch(request);
  },
};
