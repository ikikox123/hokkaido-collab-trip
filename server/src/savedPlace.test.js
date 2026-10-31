import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AI_INPUT_CHARS, AI_MAX_TOKENS, aiExtract, buildAiRequest, buildExtractionInput, canonicalSourceUrl, cleanPlacePatch,
  decideExtraction, extractHtmlMeta, googleMapsSearchUrl, heuristicExtract, parseAiAnswer, parseIngestBody,
  readLimitedText, resultMessage,
} from './savedPlace.js';
import { runIngest } from './savedIngest.js';
import { createPlaceGeocoder, MIN_INTERVAL_MS } from './nominatimGeocode.js';

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
  assert.equal(h.city, '札幌');
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
  const low = await runIngest({ text: '店', ai: goodAi({ confidence: 0.59 }) });
  const high = await runIngest({ text: '店', ai: goodAi({ confidence: 0.6 }) });
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
  assert.deepEqual(cleanPlacePatch({ name: ' A\nB ', type: 'eat', city: '札幌' }).set, { name: 'A B', type: 'eat', city: '札幌' });
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

test('Nominatim: custom User-Agent, one request per second, no Google', async () => {
  nominatim.calls.length = 0;
  const c = clock();
  const geocode = createPlaceGeocoder({ fetchImpl: nominatim([{ lat: '43.05', lon: '141.35', display_name: '札幌市' }]), now: c.now, sleep: c.sleep });
  const out = await Promise.all([geocode({ name: 'A', city: '札幌' }), geocode({ name: 'B', city: '札幌' }), geocode({ name: 'C', city: '札幌' })]);
  assert.deepEqual(out[0], { lat: 43.05, lng: 141.35, address: '札幌市' });
  assert.equal(nominatim.calls.length, 3);
  assert.match(nominatim.calls[0].init.headers['User-Agent'], /hokkaido/);
  assert.match(nominatim.calls[0].url, /^https:\/\/nominatim\.openstreetmap\.org\/search\?/);
  assert.doesNotMatch(nominatim.calls.map((x) => x.url).join(), /google/);
  assert.equal(c.sleeps.length, 2, 'second and third waited');
  assert.ok(c.sleeps.every((ms) => ms > 0 && ms <= MIN_INTERVAL_MS));
});

test('Nominatim: hits and misses are cached, failures are not', async () => {
  nominatim.calls.length = 0;
  const c = clock();
  const geocode = createPlaceGeocoder({ fetchImpl: nominatim([{ lat: '1', lon: '2', display_name: 'x' }]), now: c.now, sleep: c.sleep });
  await geocode({ name: 'A' });
  await geocode({ name: 'a' });
  assert.equal(nominatim.calls.length, 1);

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
