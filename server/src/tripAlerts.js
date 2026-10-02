/** Combined forecast, JMA warnings, and JR Hokkaido status for the itinerary. */

import { getWeather } from './weather.js';
import { JMA_PULL_PAGE, getJmaWarnings } from './jmaWarnings.js';
import { JR_OFFICIAL_URL, getJrStatus } from './jrStatus.js';

export const SOURCE_NOTICE =
  '預報來自 Open-Meteo；警報來自氣象廳；tenki.jp 無公開可串接 API（需付費商業授權）。';

function presentWeather(result) {
  if (!result || result.status !== 200) {
    return {
      ok: false,
      cities: [],
      stale: false,
      error: result?.body?.error || '天氣取得失敗',
    };
  }
  return { ok: true, cities: [], ...result.body };
}

export async function getTripAlerts(options = {}) {
  const weatherFn = options.getWeather ?? getWeather;
  const warningsFn = options.getWarnings ?? getJmaWarnings;
  const jrFn = options.getJrStatus ?? getJrStatus;

  const [weather, warnings, jr] = await Promise.all([
    Promise.resolve()
      .then(() => weatherFn())
      .then(presentWeather)
      .catch(() => presentWeather(null)),
    Promise.resolve()
      .then(() => warningsFn())
      .catch(() => ({
        ok: false,
        stale: false,
        partial: false,
        calm: false,
        fetchedAt: null,
        sourceUrl: JMA_PULL_PAGE,
        areas: [],
        headlines: [],
        error: '警報暫時無法更新',
      })),
    Promise.resolve()
      .then(() => jrFn())
      .catch(() => ({
        ok: false,
        stale: false,
        officialUrl: JR_OFFICIAL_URL,
        officialTime: '',
        fetchedAt: null,
        areas: [],
        error: '暫時無法取得運行摘要',
      })),
  ]);

  return { weather, warnings, jr, notice: SOURCE_NOTICE };
}
