import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeatherCache, getWeather } from './weather.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function forecast(temp, code = 0) {
  return { current: { temperature_2m: temp, weather_code: code, time: '2026-10-02T12:00' } };
}

function quiet() {}

test('fresh forecasts are cached with stale false', async () => {
  const cache = createWeatherCache();
  const result = await getWeather({
    cache,
    sleep: quiet,
    warn: quiet,
    now: () => new Date('2026-10-02T03:00:00.000Z'),
    fetchImpl: async (url) => {
      if (url.includes('latitude=43.06')) return jsonResponse(forecast(2, 0));
      if (url.includes('latitude=43.19')) return jsonResponse(forecast(3, 1));
      return jsonResponse(forecast(-1, 71));
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.stale, false);
  assert.equal(result.body.fetchedAt, '2026-10-02T03:00:00.000Z');
  assert.deepEqual(
    result.body.cities.map((city) => [city.id, city.temperature, city.weatherCode]),
    [
      ['sapporo', 2, 0],
      ['otaru', 3, 1],
      ['asahikawa', -1, 71],
    ],
  );
  assert.equal(cache.current.fetchedAt, result.body.fetchedAt);
});

test('a total upstream failure serves the last success as stale', async () => {
  const cache = createWeatherCache();
  const first = await getWeather({
    cache,
    sleep: quiet,
    warn: quiet,
    maxAttempts: 1,
    now: () => new Date('2026-10-02T03:00:00.000Z'),
    fetchImpl: async () => jsonResponse(forecast(5, 2)),
  });
  assert.equal(first.status, 200);

  let calls = 0;
  const second = await getWeather({
    cache,
    sleep: quiet,
    warn: quiet,
    maxAttempts: 2,
    now: () => new Date('2026-10-02T04:00:00.000Z'),
    fetchImpl: async () => {
      calls += 1;
      throw new Error('upstream down');
    },
  });

  assert.equal(second.status, 200);
  assert.equal(second.body.stale, true);
  assert.equal(second.body.fetchedAt, '2026-10-02T03:00:00.000Z');
  assert.equal(second.body.warning, '天氣暫時使用稍早的資料');
  assert.equal(second.body.cities.length, 3);
  assert.equal(second.body.cities[0].temperature, 5);
  assert.equal(calls, 6);
  assert.equal(cache.current.fetchedAt, first.body.fetchedAt);
});

test('502 only when every city fails and nothing is cached', async () => {
  const result = await getWeather({
    cache: createWeatherCache(),
    sleep: quiet,
    warn: quiet,
    maxAttempts: 1,
    fetchImpl: async () => jsonResponse({}, 503),
  });

  assert.equal(result.status, 502);
  assert.equal(result.body.error, '天氣取得失敗');
  assert.match(result.body.detail, /503/);
});

test('partial success returns the cities that responded', async () => {
  const result = await getWeather({
    cache: createWeatherCache(),
    sleep: quiet,
    warn: quiet,
    maxAttempts: 1,
    now: () => new Date('2026-10-02T05:00:00.000Z'),
    fetchImpl: async (url) => {
      if (url.includes('latitude=43.77')) throw new Error('asahikawa down');
      return jsonResponse(forecast(4, 2));
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.stale, false);
  assert.equal(result.body.warning, '部分城市暫時無法更新');
  assert.deepEqual(
    result.body.cities.map((city) => city.id),
    ['sapporo', 'otaru'],
  );
});

test('a failed city is filled from cache and the payload is marked stale', async () => {
  const cache = createWeatherCache();
  await getWeather({
    cache,
    sleep: quiet,
    warn: quiet,
    maxAttempts: 1,
    now: () => new Date('2026-10-02T03:00:00.000Z'),
    fetchImpl: async () => jsonResponse(forecast(9, 3)),
  });

  const result = await getWeather({
    cache,
    sleep: quiet,
    warn: quiet,
    maxAttempts: 1,
    now: () => new Date('2026-10-02T03:10:00.000Z'),
    fetchImpl: async (url) => {
      if (url.includes('latitude=43.77')) throw new Error('asahikawa down');
      return jsonResponse(forecast(11, 0));
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.stale, true);
  assert.equal(result.body.cities.find((city) => city.id === 'sapporo').temperature, 11);
  assert.equal(result.body.cities.find((city) => city.id === 'asahikawa').temperature, 9);
  assert.equal(result.body.fetchedAt, '2026-10-02T03:10:00.000Z');
});

test('a timed-out city is retried and can still succeed', async () => {
  const attempts = new Map();
  const result = await getWeather({
    cache: createWeatherCache(),
    sleep: quiet,
    warn: quiet,
    maxAttempts: 2,
    timeoutMs: 8000,
    fetchImpl: async (url) => {
      const n = (attempts.get(url) || 0) + 1;
      attempts.set(url, n);
      if (url.includes('latitude=43.19') && n === 1) {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'TimeoutError';
        throw err;
      }
      return jsonResponse(forecast(0, 0));
    },
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.cities.length, 3);
  const otaruUrl = [...attempts.keys()].find((url) => url.includes('latitude=43.19'));
  assert.equal(attempts.get(otaruUrl), 2);
});

test('each city fetch is aborted at the timeout', async () => {
  const result = await getWeather({
    cache: createWeatherCache(),
    sleep: quiet,
    warn: quiet,
    timeoutMs: 30,
    maxAttempts: 1,
    fetchImpl: (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error('missing abort signal'));
          return;
        }
        if (signal.aborted) {
          reject(new Error('already aborted'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            const err = new Error('aborted');
            err.name = 'TimeoutError';
            reject(err);
          },
          { once: true },
        );
      }),
  });

  assert.equal(result.status, 502);
  assert.match(result.body.detail, /timeout/);
});
