import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodePolyline,
  directionsProfile,
  findPlace,
  inHokkaido,
  lookupPlace,
  placeFailureMessage,
  redactSecrets,
} from './googleMaps.js';

const KEY = 'test-server-key';
const BIAS = 'circle:120000@43.4,142.0';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function installFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    calls.push({ href, init });
    return handler(href, init);
  };
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const sapporoGeocode = {
  status: 'OK',
  results: [
    {
      formatted_address: '日本、〒060-0001 北海道札幌市中央区北１条西２丁目',
      geometry: { location: { lat: 43.062583, lng: 141.353611 } },
    },
  ],
};

const legacyDenied = {
  status: 'REQUEST_DENIED',
  error_message: `You’re calling a legacy API, which is not enabled. key=${KEY}`,
};

function routeGoogle(href, { geocode, places, legacy }) {
  if (href.includes('/geocode/')) return jsonResponse(200, geocode);
  if (href.includes('places:searchText')) return places;
  if (href.includes('findplacefromtext')) return jsonResponse(200, legacy);
  throw new Error(`unexpected Google URL ${href.split('?')[0]}`);
}

test('directions profile maps trip modes onto Google travel modes', () => {
  assert.deepEqual(directionsProfile('walk'), { travelMode: 'walking', transitMode: null });
  for (const mode of ['taxi', 'car', 'charter']) {
    assert.equal(directionsProfile(mode).travelMode, 'driving');
  }
  assert.equal(directionsProfile('subway').travelMode, 'transit');
  assert.equal(directionsProfile('subway').transitMode, 'subway');
  assert.equal(directionsProfile('jr').transitMode, 'rail');
  assert.equal(directionsProfile('bus').transitMode, 'bus');
});

test('decodes the Google polyline sample', () => {
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(pts.length, 3);
  assert.ok(Math.abs(pts[0][0] - 38.5) < 1e-4);
  assert.ok(Math.abs(pts[0][1] - -120.2) < 1e-4);
  assert.ok(Math.abs(pts[1][0] - 40.7) < 1e-4);
  assert.ok(Math.abs(pts[1][1] - -120.95) < 1e-4);
  assert.ok(Math.abs(pts[2][0] - 43.252) < 1e-4);
  assert.ok(Math.abs(pts[2][1] - -126.453) < 1e-4);
});

test('redactSecrets strips the key and key= query values', () => {
  const key = 'test-key-value';
  const raw = `https://maps.googleapis.com/maps/api/directions/json?key=${key}&mode=walking`;
  const out = redactSecrets(`status ${key} ${raw}`, key);
  assert.equal(out.includes(key), false);
  assert.match(out, /key=\[redacted\]/);
});

test('Hokkaido bounds reject a Tokyo point', () => {
  assert.equal(inHokkaido(43.06, 141.35), true);
  assert.equal(inHokkaido(35.68, 139.76), false);
});

test('findPlace returns null when the legacy API is REQUEST_DENIED or empty', async () => {
  const denied = installFetch((href) => {
    assert.equal(href.includes(KEY), true);
    return jsonResponse(200, legacyDenied);
  });
  try {
    assert.equal(await findPlace('Lawson 札幌', KEY, { bias: BIAS }), null);
  } finally {
    denied.restore();
  }

  const empty = installFetch(() => jsonResponse(200, { status: 'ZERO_RESULTS' }));
  try {
    assert.equal(await findPlace('nowhere', KEY), null);
  } finally {
    empty.restore();
  }
});

test('lookupPlace returns a Hokkaido geocode when legacy Find Place is denied', async () => {
  const mock = installFetch((href) =>
    routeGoogle(href, {
      geocode: sapporoGeocode,
      places: jsonResponse(403, {
        error: { status: 'PERMISSION_DENIED', message: `Places API (New) disabled key=${KEY}` },
      }),
      legacy: legacyDenied,
    }),
  );
  try {
    const place = await lookupPlace('Lawson 札幌', KEY, { bias: BIAS });
    assert.equal(place.source, 'geocode');
    assert.equal(place.lat, 43.062583);
    assert.equal(place.lng, 141.353611);
    assert.equal(inHokkaido(place.lat, place.lng), true);
    assert.equal(mock.calls.some((call) => call.href.includes('/geocode/')), true);
    const leaked = JSON.stringify(place);
    assert.equal(leaked.includes(KEY), false);
  } finally {
    mock.restore();
  }
});

test('lookupPlace uses Places API (New) when Geocoding misses', async () => {
  const mock = installFetch((href) =>
    routeGoogle(href, {
      geocode: { status: 'ZERO_RESULTS', results: [] },
      places: jsonResponse(200, {
        places: [
          {
            displayName: { text: '札幌市時計台' },
            formattedAddress: '日本、〒060-0001 北海道札幌市中央区北１条西２丁目',
            location: { latitude: 43.062583, longitude: 141.353611 },
          },
        ],
      }),
      legacy: legacyDenied,
    }),
  );
  try {
    const place = await lookupPlace('時計台', KEY, { bias: BIAS });
    assert.equal(place.source, 'places');
    assert.equal(place.name, '札幌市時計台');
    assert.equal(place.lat, 43.062583);
    assert.equal(place.lng, 141.353611);
    const placesCall = mock.calls.find((call) => call.href.includes('places:searchText'));
    assert.ok(placesCall);
    assert.equal(placesCall.href.includes(KEY), false);
    assert.equal(placesCall.init.headers['X-Goog-Api-Key'], KEY);
    const body = JSON.parse(placesCall.init.body);
    assert.equal(body.textQuery, '時計台');
    assert.equal(body.locationBias.circle.radius, 50000);
    assert.equal(mock.calls.some((call) => call.href.includes('findplacefromtext')), false);
  } finally {
    mock.restore();
  }
});

test('lookupPlace returns null when Places are denied and Geocoding has no hit', async () => {
  const mock = installFetch((href) =>
    routeGoogle(href, {
      geocode: { status: 'ZERO_RESULTS', results: [] },
      places: jsonResponse(403, { error: { status: 'PERMISSION_DENIED', message: 'not enabled' } }),
      legacy: legacyDenied,
    }),
  );
  try {
    const place = await lookupPlace('Lawson 札幌', KEY, { bias: BIAS });
    assert.equal(place, null);
    assert.equal(mock.calls.some((call) => call.href.includes('/geocode/')), true);
    assert.equal(mock.calls.some((call) => call.href.includes('findplacefromtext')), true);
  } finally {
    mock.restore();
  }
});

test('lookupPlace surfaces a redacted Geocoding denial when every lookup fails', async () => {
  const mock = installFetch((href) =>
    routeGoogle(href, {
      geocode: {
        status: 'REQUEST_DENIED',
        error_message: `The provided API key is invalid: ${KEY}`,
      },
      places: jsonResponse(403, { error: { status: 'PERMISSION_DENIED', message: KEY } }),
      legacy: legacyDenied,
    }),
  );
  try {
    await assert.rejects(() => lookupPlace('時計台', KEY, { bias: BIAS }), (err) => {
      assert.equal(String(err.message).includes(KEY), false);
      assert.match(err.message, /REQUEST_DENIED/);
      const client = placeFailureMessage(err);
      assert.equal(client.includes(KEY), false);
      assert.match(client, /Geocoding API/);
      assert.equal(client.includes('REQUEST_DENIED'), false);
      assert.equal(placeFailureMessage(err.message), client);
      return true;
    });
  } finally {
    mock.restore();
  }
});
