import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { signJwt } from '../src/jwt.js';
import { createSavedStore, presentPlace } from '../src/savedStore.js';
import { sha256Hex, parseSavedKey } from '../../server/src/savedKey.js';

// tripHub.js imports `cloudflare:workers`, which only exists inside workerd (same stand-in as stopInfo.test.js).
const STUB = 'export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }';
register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, next) {
      if (specifier === 'cloudflare:workers') {
        return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(STUB)}), shortCircuit: true };
      }
      return next(specifier, context);
    }
  `)}`,
);
globalThis.WebSocketRequestResponsePair ??= class {};
const { TripHub } = await import('../src/tripHub.js');

const SECRET = 'worker-saved-secret';

/** The Durable Object's sql API over a real in-memory SQLite, so stored bytes can be inspected. */
function sqlOver(db) {
  return {
    exec(query, ...args) {
      const stmt = db.prepare(query);
      if (/^\s*select/i.test(query)) {
        const rows = stmt.all(...args);
        return { toArray: () => rows, one: () => rows[0] };
      }
      stmt.run(...args);
      return { toArray: () => [], one: () => undefined };
    },
  };
}

async function makeHub({ environment = 'development', ai, fetchImpl, geocode } = {}) {
  const db = new DatabaseSync(':memory:');
  let booting;
  const ctx = {
    storage: { sql: sqlOver(db) },
    getWebSockets: () => [],
    setWebSocketAutoResponse() {},
    blockConcurrencyWhile(fn) {
      booting = fn();
    },
  };
  const env = { ENVIRONMENT: environment, JWT_SECRET: SECRET };
  if (ai) env.AI = ai;
  const hub = new TripHub(ctx, env);
  await booting;
  hub.savedFetch = fetchImpl ?? (async () => { throw new Error('network is not available in tests'); });
  hub.placeGeocoder = geocode ?? (async () => null);
  const carol = await hub.users.register({ username: 'carol', password: 'carolpass1' });
  const tokens = {
    alice: await signJwt({ id: 'u1', username: 'alice', displayName: 'Alice' }, SECRET),
    bob: await signJwt({ id: 'u2', username: 'bob', displayName: 'Bob' }, SECRET),
    carol: carol.ok ? await signJwt(carol.user, SECRET) : null,
  };
  const call = (method, path, { token, body, headers = {}, raw } = {}) =>
    hub.fetch(
      new Request(`https://trip.test${path}`, {
        method,
        headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
      }),
    );
  const makeKey = async (who = 'alice') => (await (await call('POST', '/api/saved/key', { token: tokens[who] })).json()).key;
  return { hub, db, tokens, call, makeKey };
}

const goodAi = (over = {}) => ({
  calls: 0,
  async run(model, req) {
    this.calls += 1;
    this.last = { model, req };
    return { response: { name: '空', country: '日本', city: '札幌', district: '中央区', type: 'eat', confidence: 0.9, ...over } };
  },
});
const ingest = (call, key, body) => call('POST', '/api/saved/ingest', { token: key, body });
const dump = (db) =>
  ['saved_keys', 'saved_places', 'doc_chunks', 'users']
    .map((t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all()))
    .join('\n');

test('the key is returned once and only its hash is stored', async () => {
  const { call, tokens, db } = await makeHub();
  const res = await call('POST', '/api/saved/key', { token: tokens.alice });
  assert.equal(res.status, 201);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const { key, createdAt, hasKey } = await res.json();
  assert.match(key, /^hks_/);
  assert.equal(hasKey, true);
  assert.ok(createdAt);

  const info = await (await call('GET', '/api/saved/key', { token: tokens.alice })).json();
  assert.deepEqual(Object.keys(info).sort(), ['createdAt', 'hasKey']);
  assert.equal(info.hasKey, true);

  const { keyId, secret } = parseSavedKey(key);
  const stored = db.prepare('SELECT * FROM saved_keys').all();
  assert.equal(stored.length, 1);
  assert.equal(stored[0].key_id, keyId);
  assert.equal(stored[0].secret_hash, await sha256Hex(secret));
  const everything = dump(db);
  assert.ok(!everything.includes(secret), 'plaintext secret is nowhere in the database');
  assert.ok(!everything.includes(key), 'plaintext key is nowhere in the database');
});

test('making a new key replaces the old one; revoking removes it', async () => {
  const { call, tokens, makeKey } = await makeHub();
  const first = await makeKey();
  const second = await makeKey();
  assert.notEqual(first, second);
  assert.equal((await ingest(call, first, { text: 'x' })).status, 401);
  assert.equal((await ingest(call, second, { text: 'x' })).status, 200);
  const del = await call('DELETE', '/api/saved/key', { token: tokens.alice });
  assert.deepEqual(await del.json(), { hasKey: false, createdAt: null });
  assert.equal((await ingest(call, second, { text: 'x' })).status, 401);
  assert.equal((await (await call('GET', '/api/saved/key', { token: tokens.alice })).json()).hasKey, false);
});

test('regenerating leaves exactly one key, the new one', async () => {
  const { makeKey, db } = await makeHub();
  const first = await makeKey();
  const second = await makeKey();
  const rows = db.prepare('SELECT key_id FROM saved_keys').all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].key_id, parseSavedKey(second).keyId);
  assert.notEqual(rows[0].key_id, parseSavedKey(first).keyId);
});

test('if storing the new key fails, the old key is kept', async () => {
  const db = new DatabaseSync(':memory:');
  const real = sqlOver(db);
  let failInsert = false;
  const store = createSavedStore({
    exec(query, ...args) {
      if (failInsert && /INSERT INTO saved_keys/.test(query)) throw new Error('disk full');
      return real.exec(query, ...args);
    },
  });
  const { key } = await store.createKey('u1');
  failInsert = true;
  await assert.rejects(store.createKey('u1'), /disk full/);
  failInsert = false;
  const rows = db.prepare('SELECT key_id FROM saved_keys').all();
  assert.deepEqual(rows.map((r) => r.key_id), [parseSavedKey(key).keyId]);
});

test('ingest reports extractor and ai state, and logs only that', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    for (const [options, via, ai] of [
      [{}, 'heuristic', 'unbound'],
      [{ ai: { run: async () => { throw new Error('3036'); } } }, 'heuristic', 'error'],
      [{ ai: goodAi() , geocode: async () => ({ lat: 1, lng: 2, address: 'x', precision: 'place' }) }, 'ai', 'answered'],
    ]) {
      const { call, makeKey } = await makeHub(options);
      const body = await (await ingest(call, await makeKey(), { text: '秘密の店 https://example.com/secret' })).json();
      assert.equal(body.extractor, via);
      assert.equal(body.ai, ai);
    }
  } finally {
    console.log = original;
  }
  assert.deepEqual(lines.filter((l) => l.startsWith('[saved]')), [
    '[saved] ingest extractor=heuristic ai=unbound',
    '[saved] ingest extractor=heuristic ai=error',
    '[saved] ingest extractor=ai ai=answered',
  ]);
});

test('wrong, malformed, missing and revoked keys get 401', async () => {
  const { call, makeKey } = await makeHub();
  const key = await makeKey();
  const { keyId } = parseSavedKey(key);
  for (const bad of [undefined, '', 'nope', `hks_${keyId}_${'A'.repeat(43)}`, `hks_ffffffff_${'A'.repeat(43)}`, key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A')]) {
    const res = await ingest(call, bad, { text: 'x' });
    assert.equal(res.status, 401, String(bad));
  }
});

test('a Shortcut key cannot be used anywhere but ingest, and a login token cannot ingest', async () => {
  const { call, tokens, makeKey } = await makeHub();
  const key = await makeKey();
  for (const [method, path] of [
    ['GET', '/api/me'], ['GET', '/api/trip'], ['GET', '/api/saved?scope=mine'], ['GET', '/api/saved?scope=shared'],
    ['GET', '/api/saved/key'], ['POST', '/api/saved/key'], ['DELETE', '/api/saved/key'],
    ['GET', '/api/places?q=x'], ['GET', '/api/opening-hours?name=a&lat=1&lng=1'],
  ]) {
    const res = await call(method, path, { token: key });
    assert.equal(res.status, 403, `${method} ${path}`);
    assert.equal((await res.json()).error, '這把金鑰只能用來收藏', `${method} ${path}`);
  }
  assert.equal((await call('POST', '/api/login', { token: key, body: { username: 'alice', password: key } })).status, 401);
  assert.equal((await call('POST', '/api/saved/ingest', { token: tokens.alice, body: { text: 'x' } })).status, 401);
  assert.equal((await call('POST', '/api/saved/ingest', { body: { text: 'x' } })).status, 401);
});

test('rate limit: 11th call in a minute is 429 with Retry-After, per key', async () => {
  const { call, makeKey } = await makeHub();
  const a = await makeKey('alice');
  const b = await makeKey('bob');
  for (let i = 0; i < 10; i++) assert.equal((await ingest(call, a, { text: `p${i}` })).status, 200, `call ${i}`);
  const blocked = await ingest(call, a, { text: 'p11' });
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
  assert.equal((await ingest(call, b, { text: 'other user' })).status, 200);
});

test('daily limit applies after minute windows roll over', async () => {
  const { hub, call, makeKey } = await makeHub();
  const key = await makeKey();
  let now = Date.now();
  const realNow = Date.now;
  Date.now = () => now;
  try {
    hub.savedLimits = (await import('../src/savedRoutes.js')).createSavedLimiters();
    const { createSavedRateLimiter } = await import('../../server/src/savedRateLimit.js');
    hub.savedLimits.key = createSavedRateLimiter({ now: () => now });
    hub.savedLimits.ip = createSavedRateLimiter({ perMinute: 1000, perDay: 100000, now: () => now });
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      for (let j = 0; j < 10; j++) if ((await ingest(call, key, { text: `d${i}-${j}` })).status === 200) ok += 1;
      now += 61_000;
    }
    assert.equal(ok, 200);
  } finally {
    Date.now = realNow;
  }
});

test('size limits answer 413', async () => {
  const { call, makeKey } = await makeHub();
  const key = await makeKey();
  const big = await call('POST', '/api/saved/ingest', { token: key, raw: JSON.stringify({ text: 'x', pad: 'y'.repeat(17 * 1024) }), headers: { 'content-type': 'application/json' } });
  assert.equal(big.status, 413);
  assert.equal((await ingest(call, key, { url: `https://www.threads.net/${'a'.repeat(2100)}` })).status, 413);
  assert.equal((await ingest(call, key, { text: 'あ'.repeat(4001) })).status, 413);
  assert.equal((await ingest(call, key, { text: 'あ'.repeat(4000) })).status, 200);
  assert.equal((await ingest(call, key, {})).status, 400);
});

test('with a confident model answer the place is ready and geocoded', async () => {
  const ai = goodAi();
  const { call, makeKey } = await makeHub({
    ai,
    geocode: async () => ({ lat: 43.05, lng: 141.35, address: '札幌市中央区' }),
  });
  const key = await makeKey();
  const body = await (await ingest(call, key, { text: '空 札幌ラーメン' })).json();
  assert.equal(body.status, 'ready');
  assert.equal(body.message, '已收藏：空');
  assert.equal(body.place.lat, 43.05);
  assert.match(body.place.mapsUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.ok(ai.last.req.max_tokens <= 300);
  assert.ok(ai.last.req.messages[1].content.length <= 4100);
});

test('a rough (area) position is pending even with a confident answer, and precision is returned', async () => {
  const { call, makeKey } = await makeHub({
    ai: goodAi(),
    geocode: async () => ({ lat: 43.06, lng: 141.35, address: '札幌市', precision: 'area' }),
  });
  const body = await (await ingest(call, await makeKey(), { text: '空 札幌ラーメン' })).json();
  assert.equal(body.status, 'pending');
  assert.equal(body.place.precision, 'area');
  assert.equal(body.place.lat, 43.06);
  assert.equal(body.message, '已收藏：空（待確認）');
});

test('a precise position keeps ready and returns precision "place"', async () => {
  const { call, makeKey } = await makeHub({
    ai: goodAi(),
    geocode: async () => ({ lat: 43.05, lng: 141.35, address: 'a', precision: 'place' }),
  });
  const body = await (await ingest(call, await makeKey(), { text: '空 札幌ラーメン' })).json();
  assert.deepEqual([body.status, body.place.precision], ['ready', 'place']);
});

test('rows saved before the precision column existed still load', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE saved_places (id TEXT PRIMARY KEY, scope TEXT NOT NULL, user_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT,
    country TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', district TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '',
    lat REAL, lng REAL, source_url TEXT NOT NULL DEFAULT '', source_text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0, shared_from TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  const now = new Date().toISOString();
  const old = (id, lat) => db.prepare(`INSERT INTO saved_places (id, scope, user_id, name, status, lat, lng, created_at, updated_at) VALUES (?, 'personal', 'u1', 'old', 'ready', ?, ?, ?, ?)`).run(id, lat, lat, now, now);
  old('sp_old1', 43.1);
  old('sp_old2', null);
  const store = createSavedStore(sqlOver(db));
  createSavedStore(sqlOver(db)); // running the migration twice is harmless
  assert.equal(presentPlace(store.get('sp_old1')).precision, 'place');
  assert.equal(presentPlace(store.get('sp_old2')).precision, null);
  const fresh = store.insert({ scope: 'personal', user_id: 'u1', name: 'new', status: 'pending', lat: 1, lng: 2, precision: 'area' });
  assert.equal(presentPlace(fresh).precision, 'area');
  assert.equal(store.list('personal', 'u1').length, 3);
});

test('no AI binding, an AI error (3036), or low confidence all end as pending, never as an API failure', async () => {
  const cases = [
    {},
    { ai: { run: async () => { throw new Error('3036: you have used up your daily free allocation'); } } },
    { ai: { run: async () => { throw new Error('3040: capacity'); } } },
    { ai: goodAi({ confidence: 0.2 }) },
  ];
  for (const options of cases) {
    const { call, makeKey } = await makeHub(options);
    const key = await makeKey();
    const res = await ingest(call, key, { text: '📍 札幌ラーメン 空\n中央区' });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'pending');
    assert.match(body.message, /（待確認）$/);
    assert.equal(body.place.status, 'pending');
  }
});

test('page fetch: only allow-listed pages are requested; a hostile redirect falls back to the text', async () => {
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    return new Response(null, { status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data' } });
  };
  const { call, makeKey } = await makeHub({ ai: goodAi(), fetchImpl });
  const key = await makeKey();
  const ok = await ingest(call, key, { url: 'https://www.threads.net/@a/post/1?x=1', text: '空' });
  assert.equal(ok.status, 200);
  assert.deepEqual(asked, ['https://www.threads.net/@a/post/1']);
  assert.equal((await ok.json()).place.sourceUrl, 'https://www.threads.net/@a/post/1');

  const other = await ingest(call, key, { url: 'http://127.0.0.1:8787/admin', text: '空' });
  assert.equal(other.status, 200);
  assert.equal((await other.json()).place.sourceUrl, null);
  const onlyBad = await ingest(call, key, { url: 'https://example.com/x' });
  assert.equal(onlyBad.status, 400);
  assert.equal(asked.length, 1, 'nothing else was requested');
});

test('the same source link updates one place instead of piling up', async () => {
  const { call, tokens, makeKey } = await makeHub({ ai: goodAi() });
  const key = await makeKey();
  const first = await (await ingest(call, key, { url: 'https://www.instagram.com/p/abc/?igsh=1', text: '空' })).json();
  const again = await (await ingest(call, key, { url: 'https://www.instagram.com/p/abc/?igsh=2', text: '空 札幌' })).json();
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.place.id, first.place.id);
  const list = await (await call('GET', '/api/saved?scope=mine', { token: tokens.alice })).json();
  assert.equal(list.places.filter((p) => p.sourceUrl === 'https://www.instagram.com/p/abc').length, 1);
});

test('privacy: others cannot read, change, delete, re-run or share my places', async () => {
  const { call, tokens, makeKey } = await makeHub({ ai: goodAi() });
  const key = await makeKey('alice');
  const { place } = await (await ingest(call, key, { text: 'secret place' })).json();

  assert.equal((await call('GET', '/api/saved?scope=mine')).status, 401);
  const bobList = await (await call('GET', '/api/saved?scope=mine', { token: tokens.bob })).json();
  assert.ok(!bobList.places.some((p) => p.id === place.id));
  const carolList = await (await call('GET', '/api/saved?scope=mine', { token: tokens.carol })).json();
  assert.deepEqual(carolList.places, []);
  for (const [method, path, body] of [
    ['PATCH', `/api/saved/${place.id}`, { name: 'hacked' }],
    ['DELETE', `/api/saved/${place.id}`],
    ['POST', `/api/saved/${place.id}/reextract`, { text: 'x' }],
    ['POST', `/api/saved/${place.id}/share`],
  ]) {
    for (const who of ['bob', 'carol']) {
      assert.equal((await call(method, path, { token: tokens[who], body })).status, 404, `${who} ${method}`);
    }
    assert.equal((await call(method, path, { body })).status, 401, `anon ${method}`);
  }
  const mine = await (await call('GET', '/api/saved?scope=mine', { token: tokens.alice })).json();
  assert.equal(mine.places.find((p) => p.id === place.id).name, '空');
});

test('shared list: companions read and write, outsiders get nothing', async () => {
  const { call, tokens, makeKey } = await makeHub({ ai: goodAi() });
  const key = await makeKey('alice');
  const { place } = await (await ingest(call, key, { text: 'x' })).json();

  // carol is logged in but not a companion
  assert.equal((await call('POST', `/api/saved/${place.id}/share`, { token: tokens.alice })).status, 201);
  assert.equal((await call('GET', '/api/saved?scope=shared', { token: tokens.carol })).status, 403);
  assert.equal((await call('GET', '/api/saved?scope=shared')).status, 401);
  assert.equal((await call('GET', '/api/saved?scope=shared', { token: key })).status, 403);

  const shared = await (await call('GET', '/api/saved?scope=shared', { token: tokens.bob })).json();
  const copy = shared.places.find((p) => p.name === '空');
  assert.ok(copy);
  assert.equal(copy.scope, 'shared');
  assert.equal(copy.addedBy, 'Alice');
  assert.notEqual(copy.id, place.id);

  // sharing twice does not duplicate
  const again = await call('POST', `/api/saved/${place.id}/share`, { token: tokens.alice });
  assert.equal((await again.json()).already, true);
  const count = (await (await call('GET', '/api/saved?scope=shared', { token: tokens.bob })).json()).places.filter((p) => p.name === '空').length;
  assert.equal(count, 1);

  // outsiders and other companions cannot change or remove it; only the sharer can
  assert.equal(copy.mine, false);
  for (const [method, body] of [['PATCH', { name: 'x' }], ['DELETE', undefined]]) {
    for (const who of ['carol', 'bob']) {
      assert.equal((await call(method, `/api/saved/${copy.id}`, { token: tokens[who], body })).status, 403);
    }
  }
  const aliceView = await (await call('GET', '/api/saved?scope=shared', { token: tokens.alice })).json();
  assert.equal(aliceView.places.find((p) => p.id === copy.id).mine, true);
  const edited = await call('PATCH', `/api/saved/${copy.id}`, { token: tokens.alice, body: { name: '空（改）', district: '中央区' } });
  assert.equal((await edited.json()).place.name, '空（改）');
  assert.equal((await call('DELETE', `/api/saved/${copy.id}`, { token: tokens.alice })).status, 200);
  // the private original is still there
  const mine = await (await call('GET', '/api/saved?scope=mine', { token: tokens.alice })).json();
  assert.ok(mine.places.some((p) => p.id === place.id));
  // a non-companion cannot share into the trip
  const { place: carolPlace } = await (await ingest(call, await (async () => (await (await call('POST', '/api/saved/key', { token: tokens.carol })).json()).key)(), { text: 'carol place' })).json();
  assert.equal((await call('POST', `/api/saved/${carolPlace.id}/share`, { token: tokens.carol })).status, 403);
});

test('re-run with pasted text updates the place; confirming a pending place makes it ready', async () => {
  const { call, tokens, makeKey } = await makeHub();
  const key = await makeKey();
  const { place } = await (await ingest(call, key, { text: 'hmm' })).json();
  assert.equal(place.status, 'pending');
  assert.equal((await call('POST', `/api/saved/${place.id}/reextract`, { token: tokens.alice, body: { text: '📍 小樽 運河食堂' } })).status, 200);
  const list = await (await call('GET', '/api/saved?scope=mine', { token: tokens.alice })).json();
  const updated = list.places.find((p) => p.id === place.id);
  assert.match(updated.name, /運河食堂/);
  assert.equal(updated.status, 'pending');
  const confirmed = await (await call('PATCH', `/api/saved/${place.id}`, { token: tokens.alice, body: { name: '運河食堂', type: 'eat' } })).json();
  assert.equal(confirmed.place.status, 'ready');
  assert.equal((await call('PATCH', `/api/saved/${place.id}`, { token: tokens.alice, body: { name: '' } })).status, 400);
});

test('re-runs by a logged-in user are rate limited too', async () => {
  const { call, tokens, makeKey } = await makeHub();
  const key = await makeKey();
  const { place } = await (await ingest(call, key, { text: 'x' })).json();
  let last;
  for (let i = 0; i < 11; i++) last = await call('POST', `/api/saved/${place.id}/reextract`, { token: tokens.alice, body: { text: `t${i}` } });
  assert.equal(last.status, 429);
});

test('edits by a logged-in user are rate limited', async () => {
  const { call, tokens, makeKey } = await makeHub();
  const key = await makeKey();
  const { place } = await (await ingest(call, key, { text: 'x' })).json();
  let last;
  for (let i = 0; i < 11; i++) last = await call('PATCH', `/api/saved/${place.id}`, { token: tokens.alice, body: { name: `n${i}` } });
  assert.equal(last.status, 429);
});

test('demo rows are seeded for alice only, outside production', async () => {
  const dev = await makeHub();
  const alice = await (await dev.call('GET', '/api/saved?scope=mine', { token: dev.tokens.alice })).json();
  assert.ok(alice.places.length >= 2 && alice.places.length <= 4);
  assert.ok(alice.places.every((p) => p.name.startsWith('範例')));
  assert.equal((await (await dev.call('GET', '/api/saved?scope=mine', { token: dev.tokens.bob })).json()).places.length, 0);

  const prod = await makeHub({ environment: 'production' });
  assert.equal(prod.db.prepare('SELECT COUNT(*) AS n FROM saved_places').get().n, 0);
});

test('the trip state is untouched by saving places', async () => {
  const { hub, call, makeKey, db } = await makeHub({ ai: goodAi() });
  const before = JSON.stringify(db.prepare("SELECT * FROM doc_chunks WHERE name = 'state'").all());
  const stops = hub.tripState.stops.length;
  const key = await makeKey();
  await ingest(call, key, { text: 'x' });
  assert.equal(JSON.stringify(db.prepare("SELECT * FROM doc_chunks WHERE name = 'state'").all()), before);
  assert.equal(hub.tripState.stops.length, stops);
});

test('a place shown as shared knows it is shared; the sharer re-run / edit updates the shared copy', async () => {
  const { call, tokens, makeKey } = await makeHub({ ai: goodAi({ name: '味の時計台 拉麵', district: '中央区北1条西3丁目', confidence: 0.9 }) });
  const key = await makeKey('alice');
  const { place } = await (await ingest(call, key, { text: '📍味の時計台 拉麵' })).json();
  assert.equal(place.sharedToTrip, false);
  assert.equal(place.name, '味の時計台');
  assert.equal(place.district, '中央区');
  assert.equal(place.city, '札幌市');
  const shared = (await (await call('POST', `/api/saved/${place.id}/share`, { token: tokens.alice })).json()).place;
  const listed = async () => (await (await call('GET', '/api/saved?scope=mine', { token: tokens.alice })).json()).places.find((p) => p.id === place.id);
  assert.equal((await listed()).sharedToTrip, true);
  const sharedNow = async () => (await (await call('GET', '/api/saved?scope=shared', { token: tokens.bob })).json()).places.find((p) => p.id === shared.id);

  // re-run: name, city, district, coordinates and status follow
  const rerun = await call('POST', `/api/saved/${place.id}/reextract`, { token: tokens.alice, body: { text: '📍味の時計台 駅前通り総本店 札幌市中央区北1条西3丁目 味噌拉麵' } });
  assert.equal(rerun.status, 200);
  let copy = await sharedNow();
  assert.equal(copy.scope, 'shared');
  assert.equal(copy.name, '味の時計台 駅前通り総本店');
  assert.equal(copy.city, '札幌市');
  assert.equal(copy.district, '中央区');

  // manual edit by the sharer
  const patched = await (await call('PATCH', `/api/saved/${place.id}`, { token: tokens.alice, body: { name: '時計台', city: '小樽', district: '' } })).json();
  assert.equal(patched.place.sharedToTrip, true);
  copy = await sharedNow();
  assert.deepEqual([copy.name, copy.city, copy.district, copy.status], ['時計台', '小樽市', '', patched.place.status]);
  assert.equal(copy.addedBy, 'Alice');
});

test('the shared copy follows coordinates and status from a geocoded re-run', async () => {
  const geocode = async () => ({ lat: 43.0626, lng: 141.3536, address: '北1条西3丁目', precision: 'place', matched: 'address', district: '中央区' });
  const { call, tokens, makeKey } = await makeHub({ ai: goodAi({ confidence: 0.4 }), geocode });
  const key = await makeKey('alice');
  const { place } = await (await ingest(call, key, { text: 'x' })).json();
  await call('POST', `/api/saved/${place.id}/share`, { token: tokens.alice });
  const after = await (await call('POST', `/api/saved/${place.id}/reextract`, { token: tokens.alice, body: { text: '📍空 札幌市中央区北1条西3丁目' } })).json();
  const copy = (await (await call('GET', '/api/saved?scope=shared', { token: tokens.bob })).json()).places[0];
  assert.deepEqual([copy.lat, copy.lng, copy.status, copy.district], [after.place.lat, after.place.lng, after.place.status, '中央区']);
  assert.equal(copy.lat, 43.0626);
  assert.equal(copy.status, 'ready');
});

test('old rows are shown with the new rules: street-address district trimmed, city with 市', () => {
  const row = { id: 'a', scope: 'personal', name: 'N', city: '札幌', district: '中央区北1条西3丁目', address: '', lat: null, lng: null, status: 'ready', confidence: 1, created_at: '', updated_at: '' };
  const place = presentPlace(row, {});
  assert.deepEqual([place.city, place.district], ['札幌市', '中央区']);
  assert.equal(presentPlace({ ...row, city: '小樽', district: '色内' }, {}).district, '');
  assert.equal(presentPlace({ ...row, city: '札幌', district: '狸小路' }, {}).district, '');
});
