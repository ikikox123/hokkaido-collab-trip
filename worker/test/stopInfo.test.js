import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { ensureBill } from '../../server/src/split.js';
import { createSeedState } from '../../server/src/seed.js';
import { signJwt } from '../src/jwt.js';

// tripHub.js imports `cloudflare:workers`, which only exists inside workerd.
// Resolve it to a tiny stand-in so the real Durable Object handlers run under node --test.
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
globalThis.WebSocketRequestResponsePair ??= class {
  constructor(request, response) {
    this.request = request;
    this.response = response;
  }
};
const { TripHub } = await import('../src/tripHub.js');

const SECRET = 'worker-stop-info-secret';
const ACCOUNTS = {
  u1: { id: 'u1', username: 'alice', displayName: 'Alice' },
  u2: { id: 'u2', username: 'bob', displayName: 'Bob' },
  u3: { id: 'u3', username: 'carol', displayName: 'Carol' },
};

function fakeSocket(userId) {
  let attachment = { room: 'HOKKAIDO2027', presence: { userId, displayName: userId } };
  const sent = [];
  return {
    readyState: WebSocket.OPEN,
    sent,
    events: (name) => sent.filter((m) => m.event === name).map((m) => m.data),
    send: (raw) => sent.push(JSON.parse(raw)),
    deserializeAttachment: () => attachment,
    serializeAttachment: (next) => (attachment = next),
  };
}

function makeHub() {
  const sockets = [];
  const ctx = {
    // createUserStore creates its table at construction; the handlers under test never read SQL.
    storage: { sql: { exec: () => ({ toArray: () => [], one: () => null }) } },
    getWebSockets: () => sockets,
    setWebSocketAutoResponse() {},
    blockConcurrencyWhile() {},
  };
  const hub = new TripHub(ctx, { ENVIRONMENT: 'development', JWT_SECRET: SECRET });
  hub.users = { publicById: (id) => ACCOUNTS[id] ?? null };
  hub.tripState = ensureBill(createSeedState());
  hub.saved = [];
  hub.saveState = function saveState() {
    this.saved.push(structuredClone(this.tripState));
  };
  const editor = fakeSocket('u1');
  const viewer = fakeSocket('u2');
  sockets.push(editor, viewer);
  return { hub, editor, viewer };
}

async function call(hub, ws, event, payload) {
  let result;
  await hub.handlers[event].call(hub, ws, payload, (data) => (result = data));
  return result;
}

const tokenFor = (id) => signJwt(ACCOUNTS[id], SECRET);

function legacyHub() {
  const { hub, editor, viewer } = makeHub();
  hub.scheduleEnrich = () => {}; // route lookups hit the network; not under test
  // Saved before opening hours existed: no hours, and notes missing or empty.
  hub.tripState = {
    ...hub.tripState,
    stops: [
      { id: 'old1', day: 1, date: '2027-02-12', title: '舊站點', time: '10:00', lat: 43.06, lng: 141.35 },
      { id: 'old2', day: 1, date: '2027-02-12', title: '舊站點二', time: '11:00', lat: 43.07, lng: 141.36, notes: '' },
    ],
    legs: [],
  };
  return { hub, editor, viewer };
}

test('worker legacy stops: unrelated edits and reloads never add hours or notes', async () => {
  const { hub, editor } = legacyHub();
  const before = structuredClone(hub.tripState.stops);
  const token = await tokenFor('u1');
  assert.equal((await call(hub, editor, 'trip:updateStop', { id: 'old1', patch: { time: '12:00' }, token })).ok, true);
  assert.equal((await call(hub, editor, 'trip:updateStop', { id: 'old2', patch: { title: '改名' }, token })).ok, true);
  const [a, b] = hub.tripState.stops;
  assert.deepEqual(a, { ...before[0], time: '12:00' });
  assert.deepEqual(b, { ...before[1], title: '改名' });
  assert.equal('hours' in a || 'hours' in b, false);
  assert.equal('notes' in a, false);
  // Clearing a legacy empty note changes nothing and saves nothing.
  const saves = hub.saved.length;
  assert.deepEqual(await call(hub, editor, 'trip:updateStop', { id: 'old2', patch: { notes: '', hours: '' }, token }), { ok: true, unchanged: true });
  assert.equal(hub.saved.length, saves);
});

test('worker trip:updateStop sets, broadcasts, persists and clears hours and notes', async () => {
  const { hub, editor, viewer } = legacyHub();
  const token = await tokenFor('u1');
  const result = await call(hub, editor, 'trip:updateStop', { id: 'old1', patch: { hours: ' 09:00-18:00 ', notes: ' 預約\n\n帶現金 ' }, token });
  assert.deepEqual(result, { ok: true });
  assert.equal(hub.tripState.stops[0].hours, '09:00-18:00');
  assert.equal(hub.tripState.stops[0].notes, '預約\n帶現金');
  assert.equal(viewer.events('trip:update').at(-1).stops[0].hours, '09:00-18:00');
  assert.equal(hub.saved.at(-1).stops[0].notes, '預約\n帶現金');

  assert.deepEqual(await call(hub, editor, 'trip:updateStop', { id: 'old1', patch: { hours: '', notes: null }, token }), { ok: true });
  assert.equal('hours' in hub.tripState.stops[0], false);
  assert.equal('notes' in hub.tripState.stops[0], false);
});

test('worker trip:updateStop rejects outsiders and invalid hours or notes without saving', async () => {
  const { hub, editor, viewer } = legacyHub();
  hub.tripState = { ...hub.tripState, members: [{ id: 'u1' }, { id: 'u2' }] };
  const before = structuredClone(hub.tripState.stops);
  const patch = { hours: '9-5' };
  assert.equal((await call(hub, editor, 'trip:updateStop', { id: 'old1', patch })).ok, false);
  const outsider = await call(hub, editor, 'trip:updateStop', { id: 'old1', patch, token: await tokenFor('u3') });
  assert.equal(outsider.error, '只有這趟行程的旅伴可以這樣做');
  const token = await tokenFor('u1');
  const tooLong = await call(hub, editor, 'trip:updateStop', { id: 'old1', patch: { hours: 'x'.repeat(81) }, token });
  assert.equal(tooLong.ok, false);
  assert.match(editor.events('error:edit').at(-1).error, /80/);
  assert.equal((await call(hub, editor, 'trip:updateStop', { id: 'old1', patch: { notes: 'a\nb\nc\nd' }, token })).ok, false);
  assert.equal((await call(hub, editor, 'trip:updateStop', { id: 'old1', patch: { hours: { x: 1 } }, token })).ok, true, 'non-string values are ignored like other fields');
  assert.deepEqual(hub.tripState.stops, before);
  assert.equal(hub.saved.length, 0);
  assert.equal(viewer.events('trip:update').length, 0);
});

test('worker trip:add stores cleaned hours and leaves out empty notes', async () => {
  const { hub, editor } = legacyHub();
  const token = await tokenFor('u1');
  await call(hub, editor, 'trip:add', { stop: { day: 1, title: '新店', time: '12:00', lat: 43.05, lng: 141.34, hours: ' 10:00-21:00 ', notes: '' }, token });
  const added = hub.tripState.stops.find((s) => s.title === '新店');
  assert.equal(added.hours, '10:00-21:00');
  assert.equal('notes' in added, false);
  const bad = await call(hub, editor, 'trip:add', { stop: { day: 1, title: '壞', hours: 'x'.repeat(81) }, token });
  assert.equal(bad.ok, false);
  assert.equal(hub.tripState.stops.some((s) => s.title === '壞'), false);
});

test('worker /api/opening-hours needs a companion and a valid query', async () => {
  const { hub } = makeHub();
  hub.tripState = { ...hub.tripState, members: [{ id: 'u1' }] };
  hub.bearerUser = async (request) => {
    const header = request.headers.get('authorization') || '';
    const id = header.replace('Bearer ', '');
    return ACCOUNTS[id] ? { user: ACCOUNTS[id] } : { error: Response.json({ error: '請先登入' }, { status: 401 }) };
  };
  hub.osmOpeningHours = async ({ name }) => (name === '札幌時計台' ? 'Tu-Su 08:45-17:10' : null);
  const get = (qs, as) =>
    hub.fetch(new Request(`https://x.test/api/opening-hours?${qs}`, { headers: as ? { authorization: `Bearer ${as}` } : {} }));
  assert.equal((await get('name=a&lat=43&lng=141')).status, 401);
  assert.equal((await get('name=a&lat=43&lng=141', 'u3')).status, 403);
  assert.equal((await get('lat=43&lng=141', 'u1')).status, 400);
  const res = await get(`name=${encodeURIComponent('札幌時計台')}&lat=43.0625&lng=141.3536`, 'u1');
  assert.deepEqual(await res.json(), { hours: 'Tu-Su 08:45-17:10', source: 'osm' });
  assert.deepEqual(await (await get('name=zz&lat=43&lng=141', 'u1')).json(), { hours: null, source: 'osm' });
});
