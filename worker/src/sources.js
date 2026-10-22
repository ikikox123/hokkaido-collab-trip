/**
 * One request to each outside data source, so a deploy can show which ones
 * still answer from Cloudflare's network. Nothing here is cached or stored.
 */

import { fetchLiveRate } from '../../server/src/fx.js';
import { JMA_EXTRA_FEED } from '../../server/src/jmaWarnings.js';
import { JR_TOP_JSON } from '../../server/src/jrStatus.js';
import { WEATHER_CITIES } from '../../server/src/weather.js';
import { osrmBaseUrl } from '../../server/src/legs.js';

async function probe(name, url, check) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; hokkaido-collab-trip/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { name, ok: false, status: res.status, ms, url };
    const detail = check ? await check(res) : null;
    return { name, ok: true, status: res.status, ms, url, ...(detail ? { detail } : {}) };
  } catch (err) {
    return { name, ok: false, error: err?.message || String(err), ms: Date.now() - started, url };
  }
}

export async function checkSources() {
  const city = WEATHER_CITIES[0];
  const fx = (async () => {
    const started = Date.now();
    try {
      const quote = await fetchLiveRate();
      return { name: 'fx (Yahoo Finance)', ok: true, ms: Date.now() - started, detail: `1 JPY = ${quote.twdPerJpy} TWD` };
    } catch (err) {
      return { name: 'fx (Yahoo Finance)', ok: false, ms: Date.now() - started, error: err?.message || String(err) };
    }
  })();
  const results = await Promise.all([
    fx,
    probe(
      'weather (Open-Meteo)',
      `https://api.open-meteo.com/v1/forecast?latitude=${city.lat}&longitude=${city.lng}&current=temperature_2m&timezone=Asia%2FTokyo`,
      async (res) => `${city.name} ${(await res.json())?.current?.temperature_2m}°C`,
    ),
    probe('warnings (JMA extra.xml)', JMA_EXTRA_FEED),
    probe('JR Hokkaido (top_tc.json)', JR_TOP_JSON),
    probe('route (OSRM)', `${osrmBaseUrl()}/route/v1/driving/141.35,43.06;141.36,43.07?overview=false`),
  ]);
  return { checkedAt: new Date().toISOString(), allOk: results.every((r) => r.ok), results };
}
