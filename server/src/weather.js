/** Open-Meteo proxy with per-city retries and a last-success memory cache. */

export const WEATHER_CITIES = [
  { id: 'sapporo', name: '札幌', lat: 43.06, lng: 141.35 },
  { id: 'otaru', name: '小樽', lat: 43.19, lng: 140.99 },
  { id: 'asahikawa', name: '旭川', lat: 43.77, lng: 142.36 },
];

export const WEATHER_TIMEOUT_MS = 8000;
export const WEATHER_MAX_ATTEMPTS = 3;
export const WEATHER_BACKOFF_MS = [400, 900];

const defaultCache = { current: null };

export function createWeatherCache() {
  return { current: null };
}

function cityUrl(city) {
  return `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lng}&current=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function errorMessage(err) {
  if (!err) return 'unknown';
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return 'timeout';
  return err.message || String(err);
}

async function fetchCity(city, { fetchImpl, timeoutMs, maxAttempts, backoffMs, sleepImpl }) {
  const url = cityUrl(city);
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetchWithTimeout(fetchImpl, url, timeoutMs);
      if (!res.ok) {
        lastError = new Error(`weather ${city.id} ${res.status}`);
      } else {
        const data = await res.json();
        return {
          ok: true,
          city: {
            ...city,
            temperature: data.current?.temperature_2m ?? null,
            weatherCode: data.current?.weather_code ?? null,
            time: data.current?.time ?? null,
          },
        };
      }
    } catch (err) {
      lastError = err;
    }

    if (attempt < maxAttempts) {
      const delay = backoffMs[attempt - 1] ?? backoffMs[backoffMs.length - 1] ?? 500;
      await sleepImpl(delay);
    }
  }

  return { ok: false, id: city.id, error: lastError };
}

/**
 * Fetch the three cities. A partial result is a success. When every city fails
 * and a previous payload exists, return that payload with stale: true.
 * 502 only when there is nothing to serve.
 */
export async function getWeather(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? WEATHER_TIMEOUT_MS;
  const maxAttempts = options.maxAttempts ?? WEATHER_MAX_ATTEMPTS;
  const backoffMs = options.backoffMs ?? WEATHER_BACKOFF_MS;
  const sleepImpl = options.sleep ?? sleep;
  const now = options.now ?? (() => new Date());
  const warn = options.warn ?? ((message) => console.warn(message));
  const cache = options.cache ?? defaultCache;

  const results = await Promise.all(
    WEATHER_CITIES.map((city) =>
      fetchCity(city, { fetchImpl, timeoutMs, maxAttempts, backoffMs, sleepImpl }),
    ),
  );

  const fresh = results.filter((result) => result.ok).map((result) => result.city);
  const failed = results.filter((result) => !result.ok);
  const detail = failed.map((result) => `${result.id}: ${errorMessage(result.error)}`).join('; ');

  if (fresh.length === 0) {
    if (cache.current) {
      warn(`[weather] open-meteo failed, serving cache${detail ? ` (${detail})` : ''}`);
      return {
        status: 200,
        body: {
          cities: cache.current.cities,
          fetchedAt: cache.current.fetchedAt,
          stale: true,
          warning: '天氣暫時使用稍早的資料',
        },
      };
    }
    warn(`[weather] open-meteo failed${detail ? `: ${detail}` : ''}`);
    return {
      status: 502,
      body: { error: '天氣取得失敗', detail: detail || 'all cities failed' },
    };
  }

  const previous = cache.current;
  const freshIds = new Set(fresh.map((city) => city.id));
  const cachedFill = (previous?.cities ?? []).filter((city) => !freshIds.has(city.id));
  const byId = new Map([...cachedFill, ...fresh].map((city) => [city.id, city]));
  const cities = WEATHER_CITIES.map((city) => byId.get(city.id)).filter(Boolean);
  const usedCache = cachedFill.length > 0;
  const fetchedAt = now().toISOString();

  cache.current = { cities, fetchedAt };

  const body = { cities, fetchedAt, stale: usedCache };
  if (failed.length > 0) {
    body.warning = usedCache ? '部分城市使用稍早的資料' : '部分城市暫時無法更新';
    warn(`[weather] partial open-meteo failure: ${detail}`);
  }
  return { status: 200, body };
}
