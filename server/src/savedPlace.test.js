import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_INPUT_CHARS, AI_MAX_TOKENS, aiExtract, buildAiRequest, buildExtractionInput, canonicalSourceUrl, cleanLine, cleanPlacePatch,
  decideExtraction, extractHtmlMeta, looksLikePlaceName, googleMapsSearchUrl, heuristicExtract, parseAiAnswer, parseIngestBody,
  normalizeAreaName, normalizeCityName, cleanDistrict, stripNameCategory, extractStreetAddress, readLimitedText, resultMessage, statusWithGeo, resolveDistrict,
} from './savedPlace.js';
import { runIngest } from './savedIngest.js';
import { createPlaceGeocoder, MIN_INTERVAL_MS, MAX_REVERSE_PER_PLACE } from './nominatimGeocode.js';

const PAGE = `<html><head><title>Post</title>
<meta property="og:title" content="Aki on Threads">
<meta property="og:description" content="📍 札幌ラーメン 空 &amp; 中央区南3条。味噌がうまい">
<meta name="description" content="desc"></head><body><script>var x=1</script><p>Hello</p></body></html>`;
const htmlRes = (body) => new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const goodAi = (over = {}) => ({ run: async () => ({ response: { name: '空', country: '日本', city: '札幌', district: '中央区', type: 'eat', confidence: 0.9, ...over } }) });

test('ingest body: limits and shape', async () => {
  assert.equal(parseIngestBody(JSON.stringify({ url: 'https://www.threads.net/p/1', text: 'hi' })).ok, true);
  assert.equal(parseIngestBody('{').status, 400);
  assert.equal(parseIngestBody('[]').status, 400);
  assert.equal(parseIngestBody(JSON.stringify({ url: 5 })).status, 400);
  assert.equal(parseIngestBody(JSON.stringify({})).status, 400);
  assert.equal(parseIngestBody(JSON.stringify({ url: 'https://x.test/' + 'a'.repeat(2048) })).status, 413);
  assert.equal(parseIngestBody(JSON.stringify({ text: 'あ'.repeat(4001) })).status, 413);
  assert.equal(parseIngestBody(JSON.stringify({ text: 'あ'.repeat(4000) })).ok, true);
});

test('readLimitedText stops above the limit, by header or by stream', async () => {
  const small = new Request('https://x.test/', { method: 'POST', body: 'abc' });
  assert.deepEqual(await readLimitedText(small, 16), { ok: true, text: 'abc' });
  const big = new Request('https://x.test/', { method: 'POST', body: 'x'.repeat(17 * 1024) });
  assert.equal((await readLimitedText(big, 16 * 1024)).tooLarge, true);
  const noHeader = new Request('https://x.test/', { method: 'POST', body: 'x'.repeat(100) });
  noHeader.headers.delete('content-length');
  assert.equal((await readLimitedText(noHeader, 50)).tooLarge, true);
});

test('source links lose tracking parameters', () => {
  assert.equal(canonicalSourceUrl('https://www.instagram.com/p/abc/?igsh=zzz#x'), 'https://www.instagram.com/p/abc');
  assert.equal(canonicalSourceUrl('javascript:alert(1)'), '');
  assert.equal(canonicalSourceUrl('https://u:p@www.threads.net/x'), '');
});

test('meta reading decodes entities and ignores scripts', () => {
  const meta = extractHtmlMeta(PAGE);
  assert.equal(meta.ogTitle, 'Aki on Threads');
  assert.match(meta.ogDescription, /空 & 中央区南3条/);
  assert.equal(meta.description, 'desc');
  assert.match(meta.snippet, /Hello/);
  assert.doesNotMatch(meta.snippet, /var x/);
});

test('model input is capped', () => {
  const input = buildExtractionInput({ meta: null, text: 'あ'.repeat(9000) });
  assert.ok(Array.from(input).length <= AI_INPUT_CHARS);
  const req = buildAiRequest(input);
  assert.ok(req.max_tokens <= 300 && req.max_tokens === AI_MAX_TOKENS);
  assert.equal(req.response_format.type, 'json_schema');
});

test('heuristic never reaches the confidence threshold', () => {
  const h = heuristicExtract({ meta: extractHtmlMeta(PAGE), text: '' });
  assert.match(h.name, /^札幌ラーメン/);
  assert.equal(h.city, '札幌市');
  assert.equal(h.district, '中央区');
  assert.equal(h.type, 'eat');
  assert.ok(h.confidence <= 0.4);
});

test('answers from the model are cleaned and clamped', () => {
  assert.equal(parseAiAnswer({ response: '```json\n{"name":"A","type":"EAT","confidence":7}\n```' }).confidence, 1);
  assert.equal(parseAiAnswer({ response: '{"name":"A","type":"EAT","confidence":0.7}' }).type, 'eat');
  assert.equal(parseAiAnswer({ name: 'A\u0000B', type: 'spaceship', confidence: 'x' }).type, null);
  assert.equal(parseAiAnswer({ name: 'A', confidence: 'x' }).confidence, 0);
  assert.equal(parseAiAnswer('no json'), null);
  assert.equal(parseAiAnswer(null), null);
});

test('no AI binding or an AI error falls back to pending', async () => {
  const meta = extractHtmlMeta(PAGE);
  for (const ai of [undefined, null, {}, { run: async () => { throw new Error('3036: daily limit'); } }, { run: async () => ({ response: 'sorry' }) }]) {
    assert.equal(await aiExtract(ai, 'x'), null);
    const out = await runIngest({ url: 'https://www.threads.net/p/1', text: 'x', ai, fetchImpl: async () => htmlRes(PAGE) });
    assert.equal(out.status, 'pending');
    assert.equal(out.via, 'heuristic');
    assert.match(out.fields.name, /札幌ラーメン/);
  }
  assert.ok(meta);
});

test('low confidence is pending, high is ready', async () => {
  const geocode = async () => ({ lat: 1, lng: 2, address: 'x', precision: 'place' });
  const low = await runIngest({ text: '店', ai: goodAi({ confidence: 0.59 }), geocode });
  const high = await runIngest({ text: '店', ai: goodAi({ confidence: 0.6 }), geocode });
  assert.equal(low.status, 'pending');
  assert.equal(high.status, 'ready');
  assert.equal(high.via, 'ai');
  const unnamed = await runIngest({ text: '店', ai: goodAi({ name: '', confidence: 1 }) });
  assert.equal(unnamed.status, 'pending');
});

test('a failed or login-walled page still extracts from the shared text', async () => {
  let asked = 0;
  const out = await runIngest({
    url: 'https://www.instagram.com/p/x',
    text: '空 札幌',
    ai: { run: async (model, req) => { asked += 1; assert.match(req.messages[1].content, /Shared text: 空 札幌/); return goodAi().run(); } },
    fetchImpl: async () => new Response('login', { status: 403, headers: { 'content-type': 'text/html' } }),
    geocode: async () => ({ lat: 1, lng: 2, address: 'x', precision: 'place' }),
  });
  assert.equal(out.fetched, 'failed');
  assert.equal(out.status, 'ready');
  assert.equal(asked, 1);
  assert.equal(out.sourceUrl, 'https://www.instagram.com/p/x');
});

test('a non-allow-listed URL is neither fetched nor stored', async () => {
  let fetched = 0;
  const out = await runIngest({ url: 'https://evil.example/x', text: 'x', ai: goodAi(), fetchImpl: async () => { fetched += 1; return htmlRes('x'); } });
  assert.equal(fetched, 0);
  assert.equal(out.sourceUrl, '');
  assert.equal(out.rejectedUrl, true);
  assert.equal(out.fetched, 'skipped');
});

test('page text is sent to the model, not trusted as instructions', async () => {
  let sent;
  await runIngest({
    url: 'https://www.threads.net/p/1',
    text: '',
    ai: { run: async (m, req) => { sent = req; return goodAi().run(); } },
    fetchImpl: async () => htmlRes(PAGE),
  });
  assert.match(sent.messages[0].content, /untrusted/);
  assert.match(sent.messages[1].content, /Title: Aki on Threads/);
});

test('decideExtraction fills gaps from the heuristic', () => {
  const out = decideExtraction({
    ai: { name: 'X', country: '', city: '', district: '', type: null, confidence: 0.9 },
    heuristic: { name: 'h', country: '日本', city: '札幌', district: '', type: 'eat', confidence: 0.3 },
    text: '',
  });
  assert.deepEqual([out.name, out.city, out.type, out.status], ['X', '札幌', 'eat', 'ready']);
});

test('google maps link is a plain search URL', () => {
  const url = googleMapsSearchUrl({ name: '空 ラーメン', city: '札幌', district: '中央区', address: '' });
  assert.match(url, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.equal(new URL(url).searchParams.get('query'), '空 ラーメン 中央区 札幌');
});

test('shortcut message marks pending places', () => {
  assert.equal(resultMessage({ name: '空', status: 'ready' }), '已收藏：空');
  assert.equal(resultMessage({ name: '空', status: 'pending' }), '已收藏：空（待確認）');
});

test('manual edits are validated', () => {
  assert.equal(cleanPlacePatch({ name: '  ' }).ok, false);
  assert.equal(cleanPlacePatch({ type: 'boat' }).ok, false);
  assert.deepEqual(cleanPlacePatch({ name: ' A\nB ', type: 'eat', city: '札幌' }).set, { name: 'A B', type: 'eat', city: '札幌市' });
});

// ---------- Nominatim ----------

function clock() {
  let t = 1_000_000;
  const sleeps = [];
  return { now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, advance: (ms) => (t += ms), sleeps };
}
const nominatim = (list) => async (url, init) => {
  nominatim.calls.push({ url: String(url), init });
  return Response.json(list);
};
nominatim.calls = [];
const searches = () => nominatim.calls.filter((x) => !x.url.includes('/reverse'));

test('Nominatim: custom User-Agent, one request per second, no Google', async () => {
  nominatim.calls.length = 0;
  const c = clock();
  const geocode = createPlaceGeocoder({ fetchImpl: nominatim([{ lat: '43.05', lon: '141.35', display_name: '札幌市' }]), now: c.now, sleep: c.sleep });
  const out = await Promise.all([geocode({ name: 'A', city: '札幌' }), geocode({ name: 'B', city: '札幌' }), geocode({ name: 'C', city: '札幌' })]);
  assert.deepEqual(out[0], { lat: 43.05, lng: 141.35, address: '札幌市', precision: 'place' });
  assert.equal(searches().length, 3);
  assert.match(nominatim.calls[0].init.headers['User-Agent'], /hokkaido/);
  assert.match(nominatim.calls[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.doesNotMatch(nominatim.calls.map((x) => x.url).join(), /google/);
  assert.ok(c.sleeps.length >= 2, 'every later request waited');
  assert.ok(c.sleeps.every((ms) => ms > 0 && ms <= MIN_INTERVAL_MS));
});

test('Nominatim: hits and misses are cached, failures are not', async () => {
  nominatim.calls.length = 0;
  const c = clock();
  const geocode = createPlaceGeocoder({ fetchImpl: nominatim([{ lat: '1', lon: '2', display_name: 'x' }]), now: c.now, sleep: c.sleep });
  await geocode({ name: 'A' });
  await geocode({ name: 'a' });
  assert.equal(searches().length, 1);

  nominatim.calls.length = 0;
  const miss = createPlaceGeocoder({ fetchImpl: nominatim([]), now: c.now, sleep: c.sleep });
  assert.equal(await miss({ name: 'Nowhere' }), null);
  assert.equal(await miss({ name: 'Nowhere' }), null);
  assert.equal(nominatim.calls.length, 1);

  let n = 0;
  const flaky = createPlaceGeocoder({ fetchImpl: async () => { n += 1; throw new Error('down'); }, now: c.now, sleep: c.sleep });
  assert.equal(await flaky({ name: 'Z' }), null);
  assert.equal(await flaky({ name: 'Z' }), null);
  assert.equal(n, 2);
});

test('Nominatim: HTTP errors and junk coordinates leave the place without coordinates', async () => {
  const c = clock();
  const err = createPlaceGeocoder({ fetchImpl: async () => new Response('', { status: 429 }), now: c.now, sleep: c.sleep });
  assert.equal(await err({ name: 'A' }), null);
  const junk = createPlaceGeocoder({ fetchImpl: async () => Response.json([{ lat: '999', lon: 'x' }]), now: c.now, sleep: c.sleep });
  assert.equal(await junk({ name: 'B' }), null);
  assert.equal(await junk({}), null);
});

// ---------- Nominatim fallback ladder ----------

/** fetch stub: answers by a function of the q / countrycodes params and records every call. */
function ladder(answer) {
  const calls = [];
  const fetchImpl = async (url) => {
    if (String(url).includes('/reverse')) return Response.json({ address: {} });
    const q = new URL(url).searchParams;
    calls.push({ q: q.get('q'), cc: q.get('countrycodes') });
    const hit = answer(q.get('q'), q.get('countrycodes'));
    return Response.json(hit ? [{ lat: '43.1', lon: '141.2', display_name: hit }] : []);
  };
  return { calls, fetchImpl };
}
const SHOP = { name: '空', district: '中央区', city: '札幌', country: '日本' };

test('Nominatim ladder: tries name+district+city+country, name+city, then district+city (area), then city', async () => {
  const l = ladder(() => null);
  const geocode = createPlaceGeocoder({ fetchImpl: l.fetchImpl, now: clock().now, sleep: clock().sleep });
  assert.equal(await geocode(SHOP), null);
  assert.deepEqual(l.calls, [
    { q: '空 中央区 札幌 日本', cc: null },
    { q: '空 札幌', cc: null },
    { q: '中央区 札幌', cc: 'jp' },
  ], 'stops after 3 requests; name-only is skipped when district and city are known');
});

test('Nominatim ladder: name-only lookup stays when the district or city is missing', async () => {
  const l = ladder(() => null);
  const geocode = createPlaceGeocoder({ fetchImpl: l.fetchImpl, now: clock().now, sleep: clock().sleep });
  await geocode({ name: '空', city: '札幌', country: '日本' });
  assert.deepEqual(l.calls.map((c) => c.q), ['空 札幌 日本', '空 札幌', '空']);
});

test('Nominatim ladder: the district-centre step is an "area" position', async () => {
  const l = ladder((q) => (q === '中央区 札幌' ? '中央区' : null));
  const geocode = createPlaceGeocoder({ fetchImpl: l.fetchImpl, now: clock().now, sleep: clock().sleep });
  const out = await geocode(SHOP);
  assert.equal(out.precision, 'area');
  assert.equal(l.calls.length, 3);
});

test('Nominatim ladder: the first hit stops the search and is a "place"', async () => {
  const l = ladder((q) => (q === '空 札幌' ? 'shop' : null));
  const geocode = createPlaceGeocoder({ fetchImpl: l.fetchImpl, now: clock().now, sleep: clock().sleep });
  const out = await geocode(SHOP);
  assert.equal(out.precision, 'place');
  assert.equal(out.address, 'shop');
  assert.equal(l.calls.length, 2);
});

test('Nominatim ladder: area steps come last and are marked "area"; duplicate steps are skipped', async () => {
  const l = ladder((q) => (q === '中央区 札幌' ? '中央区' : null));
  const geocode = createPlaceGeocoder({ fetchImpl: l.fetchImpl, now: clock().now, sleep: clock().sleep });
  // no shop name: only the district and city steps exist
  const out = await geocode({ district: '中央区', city: '札幌', country: '日本' });
  assert.deepEqual(l.calls, [{ q: '中央区 札幌', cc: 'jp' }]);
  assert.equal(out.precision, 'area');

  const cityOnly = ladder((q) => (q === '札幌' ? '札幌市' : null));
  const g2 = createPlaceGeocoder({ fetchImpl: cityOnly.fetchImpl, now: clock().now, sleep: clock().sleep });
  const out2 = await g2({ district: '中央区', city: '札幌' });
  assert.deepEqual(cityOnly.calls.map((c) => c.q), ['中央区 札幌', '札幌']);
  assert.equal(out2.precision, 'area');
});

test('Nominatim ladder: no countrycodes unless the country is Japan', async () => {
  const l = ladder(() => null);
  const geocode = createPlaceGeocoder({ fetchImpl: l.fetchImpl, now: clock().now, sleep: clock().sleep });
  await geocode({ name: 'Cafe', city: 'Paris', country: 'France' });
  assert.ok(l.calls.every((c) => c.cc === null));
});

test('Nominatim ladder: every step shares the 1/s throttle and the cache', async () => {
  const l = ladder(() => null);
  const c = clock();
  const geocode = createPlaceGeocoder({ fetchImpl: l.fetchImpl, now: c.now, sleep: c.sleep });
  await geocode(SHOP);
  assert.equal(c.sleeps.length, 2, 'requests 2 and 3 waited');
  assert.ok(c.sleeps.every((ms) => ms > 0 && ms <= MIN_INTERVAL_MS));
  // cached misses cost no budget, so the second try reaches the city step
  await geocode(SHOP);
  assert.deepEqual(l.calls.slice(3).map((x) => x.q), ['札幌']);
  await geocode(SHOP);
  assert.equal(l.calls.length, 4, 'everything is cached now');
});

test('Nominatim ladder: a timeout stops the whole lookup and is not cached', async () => {
  let n = 0;
  const geocode = createPlaceGeocoder({ fetchImpl: async () => { n += 1; throw new Error('timeout'); }, now: clock().now, sleep: clock().sleep });
  assert.equal(await geocode(SHOP), null);
  assert.equal(n, 1);
  assert.equal(await geocode(SHOP), null);
  assert.equal(n, 2);
});

test('rough (area) position or no position makes the place pending, a precise one keeps the status', () => {
  assert.equal(statusWithGeo('ready', null), 'pending');
  assert.equal(statusWithGeo('ready', { lat: 1, lng: 2, precision: 'area' }), 'pending');
  assert.equal(statusWithGeo('ready', { lat: 1, lng: 2, precision: 'place' }), 'ready');
  assert.equal(statusWithGeo('pending', { lat: 1, lng: 2, precision: 'place' }), 'pending');
});

test('runIngest: a confident answer with only an area position is pending; a place position is ready', async () => {
  const ai = { run: async () => ({ response: { name: '空', country: '日本', city: '札幌', district: '中央区', type: 'eat', confidence: 0.95 } }) };
  const area = await runIngest({ text: '空', ai, geocode: async () => ({ lat: 1, lng: 2, address: 'x', precision: 'area' }) });
  assert.equal(area.status, 'pending');
  assert.equal(area.geo.precision, 'area');
  const none = await runIngest({ text: '空', ai, geocode: async () => null });
  assert.equal(none.status, 'pending');
  const place = await runIngest({ text: '空', ai, geocode: async () => ({ lat: 1, lng: 2, address: 'x', precision: 'place' }) });
  assert.equal(place.status, 'ready');
});

test('English / romaji city and ward names become Japanese; unknown names stay', () => {
  for (const [from, to] of [
    ['Sapporo', '札幌'], ['sapporo city', '札幌'], ['Otaru', '小樽'], ['Asahikawa', '旭川'], ['Hakodate', '函館'],
    ['Biei', '美瑛'], ['Furano', '富良野'], ['Niseko', 'ニセコ'], ['Chitose', '千歳'], ['Tokyo', '東京'],
    ['Osaka', '大阪'], ['Kyoto', '京都'], ['Chuo-ku', '中央区'], ['Chūō Ward', '中央区'], ['Kita-ku', '北区'],
    ['札幌市', '札幌市'], ['札幌', '札幌'], ['色内', '色内'], ['Japan', '日本'], ['Atlantis', 'Atlantis'], ['ススキノ', 'ススキノ'],
  ]) assert.equal(normalizeAreaName(from), to, from);
  const parsed = parseAiAnswer({ response: { name: 'Cafe', country: 'Japan', city: 'Sapporo', district: 'Chuo-ku', type: 'eat', confidence: 0.9 } });
  assert.deepEqual([parsed.country, parsed.city, parsed.district], ['日本', '札幌市', '中央区']);
});

test('review-only text is not a place name', () => {
  for (const bad of ['這家好好吃 下次還要去', '超好吃！下次還要再來', 'おいしかった。また行きたい', 'Amazing food, must try', '一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十一二三']) {
    assert.equal(looksLikePlaceName(bad), false, bad);
  }
  for (const ok of ['空 ラーメン', '札幌拉麵店 好吃屋', 'Cafe Aoi', '大通公園', '六花亭']) {
    assert.equal(looksLikePlaceName(ok), true, ok);
  }
});

test('heuristic never takes a review sentence as the name', () => {
  const h = heuristicExtract({ meta: { ogTitle: '這家好好吃 下次還要去 on Threads' }, text: '這家好好吃 下次還要去' });
  assert.equal(h.name, '');
  const marked = heuristicExtract({ meta: null, text: '【這家好好吃 下次還要去】' });
  assert.equal(marked.name, '');
  assert.equal(heuristicExtract({ meta: null, text: '📍空 ラーメン 札幌' }).name, '空 ラーメン 札幌');
});

test('AI answers: a review sentence or low confidence drops the name; the place stays pending as unnamed', async () => {
  assert.equal(parseAiAnswer({ name: '這家好好吃 下次還要去', confidence: 0.9 }).name, '');
  const lowConfidence = decideExtraction({
    ai: { name: '空', country: '', city: '', district: '', type: null, confidence: 0.1 },
    heuristic: { name: '', country: '', city: '', district: '', type: null, confidence: 0.1 },
    text: '這家好好吃 下次還要去',
  });
  assert.equal(lowConfidence.name, '');
  assert.equal(lowConfidence.status, 'pending');
  const sentence = await runIngest({
    text: '這家好好吃 下次還要去',
    ai: { run: async () => ({ response: { name: '這家好好吃 下次還要去', country: '', city: '', district: '', type: 'eat', confidence: 0.95 } }) },
    geocode: async () => { throw new Error('no name, no lookup'); },
  });
  assert.equal(sentence.fields.name, '');
  assert.equal(sentence.status, 'pending');
  assert.equal(resultMessage({ name: '', status: 'pending' }), '已收藏：（未命名）（待確認）');
});

test('login-wall and generic platform pages yield no meta, so the place stays unnamed and pending', async () => {
  for (const title of ['Threads • ログイン', 'Threads • Log in', 'Instagram', 'Login • Instagram', 'Instagram • 登入', 'Threads • 登录', 'Sign up • Threads', 'Instagram の写真と動画', 'Instagram photos and videos']) {
    assert.equal(extractHtmlMeta(`<meta property="og:title" content="${title}">`).ogTitle, '', title);
  }
  assert.equal(extractHtmlMeta('<meta property="og:title" content="札幌ラーメン on Threads">').ogTitle, '札幌ラーメン on Threads');
  const wall = '<html><head><title>Threads • ログイン</title><meta property="og:title" content="Threads • ログイン"></head><body></body></html>';
  const out = await runIngest({
    url: 'https://www.threads.net/p/1', text: 'この店 好好吃 下次還要去', fetchImpl: async () => htmlRes(wall),
  });
  assert.equal(out.fields.name, '');
  assert.equal(out.status, 'pending');
  assert.match(resultMessage({ name: out.fields.name }), /（未命名）/);
});

test('cleanLine removes < and >', () => {
  assert.equal(cleanLine('a<b>c <script>x</script>', 50), 'abc scriptx/script');
});

test('runIngest reports the AI state: unbound, error, answered', async () => {
  const unbound = await runIngest({ text: '店' });
  assert.equal(unbound.ai, 'unbound');
  const failed = await runIngest({ text: '店', ai: { run: async () => { throw new Error('3036'); } } });
  assert.equal(failed.ai, 'error');
  assert.equal(failed.via, 'heuristic');
  const answered = await runIngest({ text: '店', ai: goodAi({ confidence: 0.1 }) });
  assert.equal(answered.ai, 'answered');
  assert.equal(answered.via, 'heuristic');
  assert.equal((await runIngest({ text: '店', ai: goodAi() })).ai, 'answered');
});

// ---------- Nominatim reverse district ----------

const revFetch = (reverse, search = [{ lat: '43.0123456', lon: '141.4', display_name: '麵屋 彩未' }]) => {
  const calls = [];
  const impl = async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/reverse')) return reverse instanceof Error ? Promise.reject(reverse) : Response.json(reverse);
    return Response.json(search);
  };
  impl.calls = calls;
  return impl;
};
const reverseCalls = (f) => f.calls.filter((u) => u.includes('/reverse'));

test('reverse: OSM district overrides the AI district and keeps ready', async () => {
  const c = clock();
  const f = revFetch({ address: { suburb: '平岸', city_district: '豊平区' } });
  const geocode = createPlaceGeocoder({ fetchImpl: f, now: c.now, sleep: c.sleep });
  const out = await runIngest({ text: '麵屋 彩未', ai: goodAi({ name: '麵屋 彩未', district: '東南邊' }), geocode });
  assert.equal(out.fields.district, '豊平区');
  assert.equal(out.status, 'ready');
  const [rev] = reverseCalls(f);
  assert.match(rev, /format=jsonv2/);
  assert.match(rev, /zoom=18/);
  assert.match(rev, /addressdetails=1/);
  assert.match(rev, /lat=43\.0123456/);
});

test('reverse: falls back to suburb / quarter / neighbourhood when city_district is missing', async () => {
  const c = clock();
  const f = revFetch({ address: { neighbourhood: '薄野' } });
  const geocode = createPlaceGeocoder({ fetchImpl: f, now: c.now, sleep: c.sleep });
  assert.equal((await geocode({ name: 'A', city: '札幌' })).district, undefined, 'a neighbourhood is not an administrative district');
  const ward = createPlaceGeocoder({ fetchImpl: revFetch({ address: { suburb: '色内', quarter: '手稲区' } }), now: c.now, sleep: c.sleep });
  assert.equal((await ward({ name: 'B', city: '札幌' })).district, '手稲区');
});

test('reverse failure keeps the AI district; a non-administrative one is dropped', async () => {
  const c = clock();
  const down = createPlaceGeocoder({ fetchImpl: revFetch(new Error('down')), now: c.now, sleep: c.sleep });
  const ok = await runIngest({ text: '空', ai: goodAi({ district: '中央区' }), geocode: down });
  assert.equal(ok.fields.district, '中央区');
  assert.equal(ok.status, 'ready');
  const nofield = createPlaceGeocoder({ fetchImpl: revFetch({ address: {} }), now: c.now, sleep: c.sleep });
  const vague = await runIngest({ text: '空', ai: goodAi({ district: '東南邊' }), geocode: nofield });
  assert.equal(vague.fields.district, '', 'not 区/町/村: dropped');
  assert.equal(vague.status, 'ready');
  const empty = await runIngest({ text: '空', ai: goodAi({ district: '' }), geocode: nofield });
  assert.equal(empty.status, 'ready');
  assert.deepEqual(resolveDistrict({ district: '南3条西5丁目' }, null, 'ready'), { district: '', status: 'ready' });
  assert.deepEqual(resolveDistrict({ district: '東南邊' }, null, 'ready'), { district: '', status: 'ready' });
});

test('reverse: only for precision place, at most once, beyond the 3 search requests, shared queue and cache', async () => {
  assert.equal(MAX_REVERSE_PER_PLACE, 1);
  const c = clock();
  const area = revFetch({ address: { city_district: '豊平区' } }, [{ lat: '1', lon: '2', display_name: 'x' }]);
  const areaGeo = createPlaceGeocoder({ fetchImpl: area, now: c.now, sleep: c.sleep });
  const hit = await areaGeo({ name: '', district: '中央区', city: '札幌' });
  assert.equal(hit.precision, 'area');
  assert.equal(hit.district, undefined);
  assert.equal(reverseCalls(area).length, 0);

  // 2 empty searches then a hit on the 3rd: 3 searches + 1 reverse = 4 requests.
  let n = 0;
  const calls = [];
  const f = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/reverse')) return Response.json({ address: { city_district: '豊平区' } });
    n += 1;
    return Response.json(n < 3 ? [] : [{ lat: '43.05', lon: '141.35', display_name: 'y' }]);
  };
  const geocode = createPlaceGeocoder({ fetchImpl: f, now: c.now, sleep: c.sleep });
  const out = await geocode({ name: 'A', city: '札幌', country: '日本' });
  assert.equal(out.precision, 'place');
  assert.equal(out.district, '豊平区');
  assert.equal(calls.length, 4);
  assert.equal(calls.filter((u) => u.includes('/reverse')).length, 1);

  // Same rounded coordinates (4 decimals) come from the cache, and misses are cached too.
  const f2 = revFetch({ address: { city_district: '豊平区' } }, [{ lat: '43.01231', lon: '141.40001', display_name: 'z' }]);
  const g2 = createPlaceGeocoder({ fetchImpl: f2, now: c.now, sleep: c.sleep });
  await g2({ name: 'B' });
  await g2({ name: 'C' });
  assert.equal(reverseCalls(f2).length, 1);

  // Shared 1 req/s queue and headers.
  const c3 = clock();
  const f3 = async (url, init) => {
    f3.inits.push(init);
    return Response.json(String(url).includes('/reverse') ? { address: { suburb: '平岸' } } : [{ lat: '1', lon: '2', display_name: 'q' }]);
  };
  f3.inits = [];
  const g3 = createPlaceGeocoder({ fetchImpl: f3, now: c3.now, sleep: c3.sleep });
  await g3({ name: 'D' });
  assert.equal(f3.inits.length, 2);
  assert.equal(c3.sleeps.length, 1, 'reverse waited behind the search');
  assert.ok(f3.inits.every((i) => /hokkaido/.test(i.headers['User-Agent']) && i.headers['Accept-Language'] === 'ja'));
});

// ---------- v2: district rules, city, address, name ----------

test('district: only administrative areas; street addresses and street names are dropped', () => {
  assert.equal(cleanDistrict('中央区'), '中央区');
  assert.equal(cleanDistrict('Chuo-ku'), '中央区');
  assert.equal(cleanDistrict('中央区北1条西3丁目'), '中央区', 'old data: keep only the ward');
  assert.equal(cleanDistrict('手稲町'), '手稲町');
  for (const bad of ['北1条西3丁目', '南2条西5丁目', '狸小路', '狸小路商店街', '大通', '駅前通り', '色内1-1-1', '1番地', '薄野', '色内', '札幌市', '']) {
    assert.equal(cleanDistrict(bad), '', bad);
  }
  assert.equal(cleanDistrict('小樽町', '小樽市'), '', 'the city itself is not a district');
  const parsed = parseAiAnswer({ response: { name: '店', city: '札幌', district: '北1条西3丁目', type: 'eat', confidence: 0.9 } });
  assert.equal(parsed.district, '');
  assert.equal(parseAiAnswer({ response: { name: '店', city: '札幌', district: '狸小路', confidence: 0.9 } }).district, '');
});

test('city: 札幌 -> 札幌市, Otaru has no district, 色内 keeps its kanji', async () => {
  assert.equal(normalizeCityName('札幌'), '札幌市');
  assert.equal(normalizeCityName('Sapporo'), '札幌市');
  assert.equal(normalizeCityName('小樽市'), '小樽市');
  assert.equal(normalizeCityName('美瑛'), '美瑛町');
  assert.equal(normalizeCityName('Atlantis'), 'Atlantis');
  const f = revFetch({ address: { city: '小樽市', suburb: '色内', neighbourhood: '色内1丁目' } });
  const geocode = createPlaceGeocoder({ fetchImpl: f, now: clock().now, sleep: clock().sleep });
  const out = await runIngest({ text: '運河', ai: goodAi({ name: '小樽運河', city: '小樽', district: '色内' }), geocode });
  assert.equal(out.fields.city, '小樽市');
  assert.equal(out.fields.district, '');
  assert.equal(normalizeAreaName('色内'), '色内');
  assert.notEqual(normalizeAreaName('色内'), '色內');
});

test('trailing category words are removed from names, nothing else', () => {
  for (const [from, to] of [
    ['味の時計台 拉麵', '味の時計台'], ['すみれ ラーメン', 'すみれ'], ['空 味噌拉麵', '空'], ['空 味噌ラーメン', '空'],
    ['空 醤油ラーメン', '空'], ['空 塩ラーメン', '空'], ['Garaku 湯咖哩', 'Garaku'], ['Garaku スープカレー', 'Garaku'],
    ['すし善 壽司', 'すし善'], ['すし善 寿司', 'すし善'], ['魚民 居酒屋', '魚民'], ['Aoi 咖啡', 'Aoi'], ['Aoi カフェ', 'Aoi'],
    ['麺屋 彩未', '麺屋 彩未'], ['ラーメン', 'ラーメン'], ['拉麵', '拉麵'], ['すみれ 札幌本店', 'すみれ 札幌本店'],
  ]) assert.equal(stripNameCategory(from), to, from);
  assert.equal(parseAiAnswer({ response: { name: '味の時計台 拉麵', city: '札幌', confidence: 0.9 } }).name, '味の時計台');
  assert.equal(heuristicExtract({ meta: null, text: '📍すみれ ラーメン' }).name, 'すみれ');
  assert.equal(heuristicExtract({ meta: null, text: '📍麺屋 彩未' }).name, '麺屋 彩未');
});

const PASTED = '📍味の時計台 駅前通り総本店 札幌市中央区北1条西3丁目 味噌拉麵';

test('street address parsing', () => {
  const a = extractStreetAddress(PASTED);
  assert.deepEqual([a.text, a.city, a.district], ['札幌市中央区北1条西3丁目', '札幌市', '中央区']);
  assert.equal(extractStreetAddress('小樽市色内1-1-1').district, '');
  assert.equal(extractStreetAddress('小樽市色内1-1-1').city, '小樽市');
  assert.equal(extractStreetAddress('市場食堂 おいしい'), null);
  const h = heuristicExtract({ meta: null, text: PASTED });
  assert.deepEqual([h.name, h.city, h.district], ['味の時計台 駅前通り総本店', '札幌市', '中央区']);
});

test('a pasted full address is searched first and the place is not pending', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    calls.push(u.pathname + '?' + (u.searchParams.get('q') ?? ''));
    if (u.pathname === '/reverse') return Response.json({ address: { city_district: '中央区', suburb: '北1条西' } });
    return Response.json([{ lat: '43.0626', lon: '141.3536', display_name: '北1条西3丁目, 中央区, 札幌市' }]);
  };
  const geocode = createPlaceGeocoder({ fetchImpl, now: clock().now, sleep: clock().sleep });
  // The model only kept "味の時計台 拉麵", with a street address as district and low confidence.
  const ai = goodAi({ name: '味の時計台 拉麵', city: '札幌', district: '中央区北1条西3丁目', confidence: 0.5 });
  const out = await runIngest({ text: PASTED, ai, geocode });
  assert.equal(calls[0], '/search?札幌市中央区北1条西3丁目', 'address first');
  assert.equal(calls.filter((c) => c.startsWith('/search')).length, 2, 'address, then one shop (POI) lookup');
  assert.deepEqual([out.fields.name, out.fields.city, out.fields.district], ['味の時計台 駅前通り総本店', '札幌市', '中央区']);
  assert.equal(out.status, 'ready');
  assert.equal(out.geo.precision, 'address');

  // heuristic only (no AI)
  const heur = await runIngest({ text: PASTED, geocode: createPlaceGeocoder({ fetchImpl, now: clock().now, sleep: clock().sleep }) });
  assert.deepEqual([heur.fields.name, heur.fields.district, heur.status], ['味の時計台 駅前通り総本店', '中央区', 'ready']);

  // address not found: falls through the usual steps, still within 3 searches, and stays pending
  const searches2 = [];
  const miss = async (url) => {
    const u = new URL(url);
    if (u.pathname === '/search') searches2.push(u.searchParams.get('q'));
    return Response.json(u.pathname === '/reverse' ? { address: {} } : []);
  };
  const notFound = await runIngest({ text: PASTED, ai, geocode: createPlaceGeocoder({ fetchImpl: miss, now: clock().now, sleep: clock().sleep }) });
  assert.ok(searches2.length <= 3);
  assert.equal(notFound.status, 'pending');
  assert.equal(notFound.fields.district, '中央区');
});
