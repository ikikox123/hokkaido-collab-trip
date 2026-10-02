import test from 'node:test';
import assert from 'node:assert/strict';
import { SOURCE_NOTICE, getTripAlerts } from './tripAlerts.js';

test('trip alerts keep each section when another source fails', async () => {
  const body = await getTripAlerts({
    getWeather: async () => ({
      status: 200,
      body: { cities: [{ id: 'sapporo', name: '札幌', temperature: 1, weatherCode: 0 }], stale: false },
    }),
    getWarnings: async () => ({
      ok: true,
      calm: true,
      stale: false,
      partial: false,
      areas: [{ id: 'sapporo', name: '札幌', confirmed: true, active: [] }],
      headlines: [],
    }),
    getJrStatus: async () => {
      throw new Error('jr down');
    },
  });

  assert.equal(body.notice, SOURCE_NOTICE);
  assert.equal(
    body.notice,
    '預報來自 Open-Meteo；警報來自氣象廳；tenki.jp 無公開可串接 API（需付費商業授權）。',
  );
  assert.equal(body.weather.ok, true);
  assert.equal(body.weather.cities[0].name, '札幌');
  assert.equal(body.warnings.calm, true);
  assert.equal(body.jr.ok, false);
  assert.equal(body.jr.officialUrl, 'https://www3.jrhokkaido.co.jp/webunkou/');
});

test('a weather miss still returns warnings and the jr link', async () => {
  const body = await getTripAlerts({
    getWeather: async () => ({ status: 502, body: { error: '天氣取得失敗' } }),
    getWarnings: async () => ({ ok: false, calm: false, areas: [], headlines: [], error: '警報暫時無法更新' }),
    getJrStatus: async () => ({
      ok: true,
      officialUrl: 'https://www3.jrhokkaido.co.jp/webunkou/',
      officialTime: 't',
      areas: [],
    }),
  });
  assert.equal(body.weather.ok, false);
  assert.equal(body.warnings.calm, false);
  assert.equal(body.jr.ok, true);
});
