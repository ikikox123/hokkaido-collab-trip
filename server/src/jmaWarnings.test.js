import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createJmaCache,
  getJmaWarnings,
  isAllowedBulletinUrl,
  latestVpww53Links,
  parseWarningBulletin,
  summarizeTripWarnings,
} from './jmaWarnings.js';

const OTARU_URL = 'https://www.data.jma.go.jp/developer/xml/data/20261002135722_0_VPWW53_016000.xml';
const ASAHIKAWA_URL = 'https://www.data.jma.go.jp/developer/xml/data/20261002135720_0_VPWW53_012000.xml';
const NEWER_OTARU = 'https://www.data.jma.go.jp/developer/xml/data/20261003010000_0_VPWW53_016000.xml';

function bulletinXml({ officeName, headline, cities }) {
  const items = cities
    .map(([name, kinds]) => {
      const kindXml = kinds.length
        ? kinds
            .map(
              ([kindName, status]) =>
                `<Kind><Name>${kindName}</Name><Code>16</Code><Status>${status}</Status></Kind>`,
            )
            .join('')
        : '<Kind><Status>発表警報・注意報はなし</Status></Kind>';
      return `<Item>${kindXml}<Area><Name>${name}</Name><Code>1</Code></Area></Item>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Report>
<Control><PublishingOffice>${officeName}</PublishingOffice></Control>
<Head><Headline><Text>${headline}</Text></Headline></Head>
<Body>
<Warning type="気象警報・注意報（市町村等）">${items}</Warning>
</Body>
</Report>`;
}

const ISHIKARI = bulletinXml({
  officeName: '札幌管区気象台',
  headline: '石狩・空知・後志地方では、高波に注意してください。',
  cities: [
    ['札幌市', []],
    ['小樽市', [['波浪注意報', '継続']]],
    ['千歳市', []],
    ['島牧村', [['暴風雪警報', '発表']]],
  ],
});

const KAMIKAWA = bulletinXml({
  officeName: '旭川地方気象台',
  headline: '上川・留萌地方では、高波に注意してください。',
  cities: [
    ['旭川市', []],
    ['美瑛町', []],
    ['富良野市', []],
    ['中富良野町', []],
  ],
});

function feed(entries) {
  const body = entries
    .map(
      (entry) => `<entry><title>気象特別警報・警報・注意報</title><updated>${entry.updated}</updated>
<link type="application/xml" href="${entry.url}"/></entry>`,
    )
    .join('');
  return `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">${body}</feed>`;
}

const SHORT_EMPTY = feed([
  {
    updated: '2026-10-02T16:08:19Z',
    url: 'https://www.data.jma.go.jp/developer/xml/data/20261002160821_0_VPWW53_130000.xml',
  },
]);

const LONG = feed([
  { updated: '2026-10-02T13:57:21Z', url: OTARU_URL },
  { updated: '2026-10-02T13:57:19Z', url: ASAHIKAWA_URL },
  { updated: '2026-10-02T10:00:00Z', url: OTARU_URL.replace('135722', '100000') },
]);

function xmlResponse(body, { status = 200, etag } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    url: status === 200 ? 'https://www.data.jma.go.jp/developer/xml/feed/x' : undefined,
    headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag || null : null) },
    text: async () => body,
  };
}

function quiet() {}

test('latest links keep only JMA VPWW53 files for the trip offices', () => {
  const xml = feed([
    { updated: '2026-10-02T13:57:21Z', url: OTARU_URL },
    { updated: '2026-10-02T12:00:00Z', url: OTARU_URL },
    { updated: '2026-10-02T13:57:19Z', url: ASAHIKAWA_URL },
    {
      updated: '2026-10-02T18:00:00Z',
      url: 'https://evil.example/developer/xml/data/VPWW53_016000.xml',
    },
    {
      updated: '2026-10-02T18:00:00Z',
      url: 'https://www.data.jma.go.jp/developer/xml/data/20261002180000_0_VPWW54_016000.xml',
    },
  ]);
  const links = latestVpww53Links(xml);
  assert.deepEqual(
    links.map((link) => link.url).sort(),
    [ASAHIKAWA_URL, OTARU_URL].sort(),
  );
  assert.equal(isAllowedBulletinUrl('https://evil.example/VPWW53_016000.xml'), false);
});

test('parser keeps official kind names and drops cleared warnings', () => {
  const parsed = parseWarningBulletin(
    bulletinXml({
      officeName: '札幌管区気象台',
      headline: '石狩地方では、暴風雪に警戒してください。',
      cities: [
        ['小樽市', [['暴風雪特別警報', '発表'], ['波浪注意報', '解除']]],
        ['札幌市', []],
      ],
    }),
  );
  assert.equal(parsed.headline, '石狩地方では、暴風雪に警戒してください。');
  assert.equal(parsed.byMunicipality['札幌市'].length, 0);
  assert.deepEqual(parsed.byMunicipality['小樽市'], [
    {
      name: '暴風雪特別警報',
      status: '発表',
      statusLabel: '發布',
      level: 'special',
    },
  ]);
});

test('summary lists active trip cities and quotes a headline only when relevant', () => {
  const summary = summarizeTripWarnings({
    '016000': { parsed: parseWarningBulletin(ISHIKARI) },
    '012000': { parsed: parseWarningBulletin(KAMIKAWA) },
  });
  const otaru = summary.areas.find((area) => area.id === 'otaru');
  assert.equal(otaru.active[0].name, '波浪注意報');
  assert.equal(otaru.active[0].statusLabel, '持續');
  assert.equal(summary.areas.find((area) => area.id === 'sapporo').active.length, 0);
  assert.equal(summary.headlines.length, 1);
  assert.match(summary.headlines[0].text, /高波に注意/);
  assert.equal(summary.headlines[0].office, '札幌管区気象台');
});

test('a calm bulletin does not surface the regional headline as a city warning', () => {
  const calmIshikari = bulletinXml({
    officeName: '札幌管区気象台',
    headline: '石狩・空知・後志地方では、高波に注意してください。',
    cities: [
      ['札幌市', []],
      ['小樽市', []],
      ['千歳市', []],
    ],
  });
  const summary = summarizeTripWarnings({
    '016000': { parsed: parseWarningBulletin(calmIshikari) },
    '012000': { parsed: parseWarningBulletin(KAMIKAWA) },
  });
  assert.equal(summary.headlines.length, 0);
  assert.equal(
    summary.areas.every((area) => area.confirmed && area.active.length === 0),
    true,
  );
});

function mockFetch({ short = SHORT_EMPTY, long = LONG, files } = {}) {
  const calls = [];
  const bodies = {
    'https://www.data.jma.go.jp/developer/xml/feed/extra.xml': short,
    'https://www.data.jma.go.jp/developer/xml/feed/extra_l.xml': long,
    [OTARU_URL]: ISHIKARI,
    [ASAHIKAWA_URL]: KAMIKAWA,
    [NEWER_OTARU]: bulletinXml({
      officeName: '札幌管区気象台',
      headline: '暴風雪に警戒してください。',
      cities: [
        ['札幌市', [['暴風雪警報', '発表']]],
        ['小樽市', [['波浪注意報', '継続']]],
        ['千歳市', []],
      ],
    }),
    ...(files || {}),
  };
  const fetchImpl = async (url) => {
    calls.push(url);
    const body = bodies[url];
    if (!body) return xmlResponse('', { status: 404 });
    return xmlResponse(body, { etag: `W/"${url.length}"` });
  };
  return { fetchImpl, calls };
}

function at(iso) {
  return () => new Date(iso);
}

test('first load uses the long feed and does not download the same bulletin twice', async () => {
  const cache = createJmaCache();
  const { fetchImpl, calls } = mockFetch();
  const first = await getJmaWarnings({
    cache,
    fetchImpl,
    warn: quiet,
    now: at('2026-10-02T18:00:00.000Z'),
    longIntervalMs: 60_000,
  });
  assert.equal(first.ok, true);
  assert.equal(first.calm, false);
  assert.equal(first.areas.find((area) => area.id === 'otaru').active[0].name, '波浪注意報');
  assert.equal(first.areas.find((area) => area.id === 'asahikawa').active.length, 0);

  const second = await getJmaWarnings({
    cache,
    fetchImpl,
    warn: quiet,
    now: at('2026-10-02T18:01:00.000Z'),
  });
  assert.equal(second, first);
  assert.equal(calls.length, 4);

  await getJmaWarnings({
    cache,
    fetchImpl,
    warn: quiet,
    now: at('2026-10-02T18:06:00.000Z'),
    longIntervalMs: 60 * 60 * 1000,
  });
  const bulletinCalls = calls.filter((url) => url.includes('VPWW53_'));
  assert.deepEqual(bulletinCalls, [OTARU_URL, ASAHIKAWA_URL]);
  assert.equal(calls.filter((url) => url.endsWith('extra_l.xml')).length, 1);
});

test('a newer short-feed bulletin is downloaded once and the previous file is not', async () => {
  const cache = createJmaCache();
  const { fetchImpl, calls } = mockFetch();
  await getJmaWarnings({
    cache,
    fetchImpl,
    warn: quiet,
    now: at('2026-10-02T18:00:00.000Z'),
  });
  const before = calls.length;
  const newer = await getJmaWarnings({
    cache,
    fetchImpl,
    warn: quiet,
    now: at('2026-10-02T18:10:00.000Z'),
    longIntervalMs: 24 * 60 * 60 * 1000,
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.endsWith('extra.xml')) {
        return xmlResponse(
          feed([
            { updated: '2026-10-03T01:00:00Z', url: NEWER_OTARU },
            { updated: '2026-10-02T13:57:19Z', url: ASAHIKAWA_URL },
          ]),
        );
      }
      return fetchImpl(url);
    },
  });
  assert.equal(newer.areas.find((area) => area.id === 'sapporo').active[0].name, '暴風雪警報');
  assert.ok(calls.includes(NEWER_OTARU));
  assert.equal(calls.slice(before).filter((url) => url === OTARU_URL).length, 0);
  assert.equal(calls.filter((url) => url.endsWith('extra_l.xml')).length, 1);
});

test('feed failure serves the last success as stale and a miss is not calm', async () => {
  const cache = createJmaCache();
  const ok = mockFetch();
  await getJmaWarnings({
    cache,
    fetchImpl: ok.fetchImpl,
    warn: quiet,
    now: at('2026-10-02T18:00:00.000Z'),
  });
  const stale = await getJmaWarnings({
    cache,
    warn: quiet,
    now: at('2026-10-02T18:10:00.000Z'),
    failureCooldownMs: 0,
    fetchImpl: async () => {
      throw new Error('down');
    },
  });
  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.areas.find((area) => area.id === 'otaru').active[0].name, '波浪注意報');

  const empty = await getJmaWarnings({
    cache: createJmaCache(),
    warn: quiet,
    now: at('2026-10-02T18:00:00.000Z'),
    fetchImpl: async () => xmlResponse('<html>nope</html>', { status: 200 }),
  });
  assert.equal(empty.ok, false);
  assert.equal(empty.calm, false);
  assert.equal(empty.error, '警報暫時無法更新');
});
