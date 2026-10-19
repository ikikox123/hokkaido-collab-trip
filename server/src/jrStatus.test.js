import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  JR_OFFICIAL_URL,
  JR_TOP_JSON,
  areasFromTop,
  createJrCache,
  extractJrNotes,
  getJrStatus,
  jrDetailUrl,
  jrStatusLabel,
} from './jrStatus.js';

const SENKU_24_URL = 'https://www3.jrhokkaido.co.jp/webunkou/json/senku/senku_24_tc.json';
/** Saved from the official senku_tc.html?id=24 data on 2026-10-19 (no delays at the time). */
// Stored byte-for-byte, including the UTF-8 BOM the official server sends.
const SENKU_24_RAW = fs.readFileSync(new URL('./fixtures/jr-senku-24-tc-2026-10-19.json', import.meta.url), 'utf8');
const SENKU_24_FIXTURE = JSON.parse(SENKU_24_RAW.trim());

const SHIN_DOWN_TOP = {
  time: '2026年10月18日09點00分現在',
  today: { status: { spo: 0, doo: 0, donan: 0, dohoku: 0, doto: 0, shin: 1 } },
  tomorrow: { status: { spo: 0, doo: 0, donan: 0, dohoku: 0, doto: 0, shin: 0 } },
};



function jsonResponse(body, { status = 200, etag, url } = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    url: url || JR_TOP_JSON,
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag || null : null) },
    text: async () => text,
  };
}

const TOP = {
  time: '2026年10月3日02點25分現在',
  today: { status: { spo: 2, doo: 2, donan: 2, dohoku: 2, doto: 2, shin: 2 } },
  tomorrow: { status: { spo: 0, doo: 0, donan: 0, dohoku: 0, doto: 0, shin: 0 } },
};

function quiet() {}

test('status labels match the official code meanings', () => {
  assert.equal(jrStatusLabel(0), '無停駛、延遲訊息');
  assert.equal(jrStatusLabel(1), '停駛、延遲30分鐘以上、暫停行駛');
  assert.equal(jrStatusLabel(2), '服務時間外');
  assert.equal(jrStatusLabel(null), '狀態不明，請看官方頁');
});

test('top json keeps trip areas and hides other areas unless disrupted', () => {
  const parsed = areasFromTop(TOP);
  assert.deepEqual(
    parsed.areas.map((area) => area.id),
    ['spo', 'doo', 'dohoku'],
  );
  assert.equal(parsed.areas[0].label, '服務時間外');
  assert.equal(parsed.officialTime, TOP.time);

  const disrupted = areasFromTop({
    time: 't',
    today: { status: { spo: 0, doo: 1, donan: 0, dohoku: 0, doto: 1, shin: 0 } },
    tomorrow: { status: { spo: 1, doo: 0, donan: 0, dohoku: 0, doto: 0, shin: 0 } },
  });
  assert.deepEqual(
    disrupted.areas.map((area) => area.id),
    ['spo', 'doo', 'dohoku', 'doto'],
  );
  assert.equal(disrupted.areas[0].tomorrowLabel, '停駛、延遲30分鐘以上、暫停行駛');
});

test('notes keep the official sentence and skip the calm boilerplate', () => {
  const notes = extractJrNotes(
    {
      today: {
        gaikyo: [
          { title: '', honbun: '目前沒有延遲訊息', eikyo: { spo: 0, doo: 0 } },
          { title: '函館線', honbun: '小樽―札幌間で運転見合わせ', eikyo: { spo: 1, doo: 0 } },
          { title: '', honbun: '道東のみ遅れ', eikyo: { spo: 0, doto: 1 } },
          { title: '', honbun: '風雪<br>のため遅延', eikyo: { spo: 1 } },
        ],
      },
    },
    'spo',
  );
  assert.deepEqual(notes, ['函館線　小樽―札幌間で運転見合わせ', '風雪\nのため遅延']);
});

test('closed service does not fetch area json and is cached for five minutes', async () => {
  const cache = createJrCache();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return jsonResponse(TOP, { etag: 'W/"top"', url });
  };
  const first = await getJrStatus({
    cache,
    fetchImpl,
    warn: quiet,
    now: () => new Date('2026-10-02T17:25:00.000Z'),
  });
  assert.equal(first.ok, true);
  assert.equal(first.officialUrl, JR_OFFICIAL_URL);
  assert.equal(first.areas.find((area) => area.id === 'spo').status, 2);
  assert.deepEqual(calls, [JR_TOP_JSON]);

  const second = await getJrStatus({
    cache,
    fetchImpl,
    warn: quiet,
    now: () => new Date('2026-10-02T17:29:00.000Z'),
  });
  assert.equal(second, first);
  assert.equal(calls.length, 1);
});

test('a disruption fetches that area json once and keeps honbun verbatim', async () => {
  const cache = createJrCache();
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('top_tc.json')) {
      return jsonResponse(
        {
          time: '2026年10月3日08點00分現在',
          today: { status: { spo: 1, doo: 0, donan: 0, dohoku: 0, doto: 0, shin: 0 } },
          tomorrow: { status: { spo: 0, doo: 0, donan: 0, dohoku: 0, doto: 0, shin: 0 } },
        },
        { url },
      );
    }
    return jsonResponse(
      {
        today: {
          gaikyo: [{ title: '', honbun: '函館線で運転見合わせ', eikyo: { spo: 1, doo: 0 } }],
        },
      },
      { url },
    );
  };
  const result = await getJrStatus({
    cache,
    fetchImpl,
    warn: quiet,
    now: () => new Date('2026-10-02T23:00:00.000Z'),
  });
  assert.equal(result.areas.find((area) => area.id === 'spo').notes[0], '函館線で運転見合わせ');
  assert.equal(result.areas.find((area) => area.id === 'doo').notes.length, 0);
  assert.deepEqual(calls, [
    JR_TOP_JSON,
    'https://www3.jrhokkaido.co.jp/webunkou/json/area/area_01_tc.json',
  ]);
});

test('non-json and upstream failure do not look like a calm service', async () => {
  const blocked = await getJrStatus({
    cache: createJrCache(),
    warn: quiet,
    fetchImpl: async () =>
      jsonResponse('<html>blocked</html>', { status: 200, url: JR_TOP_JSON }),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.officialUrl, JR_OFFICIAL_URL);
  assert.equal(blocked.areas.length, 0);

  const cache = createJrCache();
  await getJrStatus({
    cache,
    warn: quiet,
    now: () => new Date('2026-10-02T17:00:00.000Z'),
    fetchImpl: async (url) => jsonResponse(TOP, { url }),
  });
  const stale = await getJrStatus({
    cache,
    warn: quiet,
    failureCooldownMs: 0,
    now: () => new Date('2026-10-02T17:06:00.000Z'),
    fetchImpl: async () => {
      throw new Error('down');
    },
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.officialTime, TOP.time);
});

test('the Shinkansen detail comes from senku_24_tc.json, not the retired area_06', () => {
  assert.equal(jrDetailUrl({ senku: '24' }), SENKU_24_URL);
  assert.equal(jrDetailUrl({ file: '01' }), 'https://www3.jrhokkaido.co.jp/webunkou/json/area/area_01_tc.json');
});

test('the saved official Shinkansen json parses and its calm text adds no note', () => {
  assert.ok(Array.isArray(SENKU_24_FIXTURE.today.gaikyo));
  assert.deepEqual(extractJrNotes(SENKU_24_FIXTURE, 'shin', { lineOnly: true }), []);
});

test('the raw official Shinkansen json, BOM included, is read through getJrStatus', async () => {
  const warnings = [];
  const result = await getJrStatus({
    cache: createJrCache(),
    warn: (message) => warnings.push(message),
    now: () => new Date('2026-10-19T08:00:00.000Z'),
    fetchImpl: async (url) =>
      url.endsWith('top_tc.json') ? jsonResponse(SHIN_DOWN_TOP, { url }) : jsonResponse(SENKU_24_RAW, { url }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.areas.find((area) => area.id === 'shin').notes, []);
  assert.deepEqual(warnings, []);
});

test('a Shinkansen disruption reads the line json and keeps its notes', async () => {
  const calls = [];
  const detail = structuredClone(SENKU_24_FIXTURE);
  detail.today.gaikyo = [
    { time: '2026年10月18日08點40分現在', title: '原因：強風', honbun: '新函館北斗～新青森間 部分列車停駛', eikyo: { spo: 0, doo: 0, donan: 1, dohoku: 0, doto: 0 } },
  ];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.endsWith('top_tc.json')) return jsonResponse(SHIN_DOWN_TOP, { url });
    return jsonResponse(detail, { url });
  };
  const result = await getJrStatus({
    cache: createJrCache(),
    fetchImpl,
    warn: quiet,
    now: () => new Date('2026-10-18T00:00:00.000Z'),
  });
  assert.equal(result.ok, true);
  const shin = result.areas.find((area) => area.id === 'shin');
  assert.equal(shin.status, 1);
  assert.equal(shin.href, 'https://www3.jrhokkaido.co.jp/webunkou/senku_tc.html?id=24');
  assert.deepEqual(shin.notes, ['原因：強風　新函館北斗～新青森間 部分列車停駛']);
  assert.deepEqual(calls, [JR_TOP_JSON, SENKU_24_URL]);
});

test('a Shinkansen detail that redirects off www3 still returns the area status', async () => {
  const warnings = [];
  const fetchImpl = async (url) => {
    if (url.endsWith('top_tc.json')) return jsonResponse(SHIN_DOWN_TOP, { url });
    return jsonResponse('<html>404</html>', { url: 'https://www.jrhokkaido.co.jp/jrherror/404-jrhp.html' });
  };
  const result = await getJrStatus({
    cache: createJrCache(),
    fetchImpl,
    warn: (message) => warnings.push(message),
    now: () => new Date('2026-10-18T00:00:00.000Z'),
  });
  assert.equal(result.ok, true);
  const shin = result.areas.find((area) => area.id === 'shin');
  assert.equal(shin.status, 1);
  assert.deepEqual(shin.notes, []);
  assert.deepEqual(warnings, ['[jr] area shin detail failed: unexpected host www.jrhokkaido.co.jp']);
});
