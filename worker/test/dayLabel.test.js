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

const SECRET = 'worker-day-label-secret';
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

async function call(hub, ws, payload) {
  let result;
  await hub.handlers['trip:setDayLabel'].call(hub, ws, payload, (data) => (result = data));
  return result;
}

const tokenFor = (id) => signJwt(ACCOUNTS[id], SECRET);

test('worker trip:setDayLabel renames, broadcasts and persists only that label', async () => {
  const { hub, editor, viewer } = makeHub();
  const stopsBefore = structuredClone(hub.tripState.stops);
  const result = await call(hub, editor, { day: 2, label: '  札幌   雪祭り ', token: await tokenFor('u1') });
  assert.deepEqual(result, { ok: true, label: '札幌 雪祭り' });
  assert.equal(hub.tripState.days[1].label, '札幌 雪祭り');
  assert.equal(hub.tripState.days[0].label, 'D1 抵達');
  assert.deepEqual(hub.tripState.stops, stopsBefore);

  const updates = viewer.events('trip:update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].days[1].label, '札幌 雪祭り');
  assert.equal(editor.events('trip:update').length, 1);
  assert.equal(hub.saved.length, 1);
  assert.equal(hub.saved[0].days[1].label, '札幌 雪祭り');
});

test('worker trip:setDayLabel resets blanks to D{n} and skips no-op saves', async () => {
  const { hub, editor } = makeHub();
  const token = await tokenFor('u1');
  assert.deepEqual(await call(hub, editor, { day: 3, label: ' \u0000 ', token }), { ok: true, label: 'D3' });
  assert.equal(hub.tripState.days[2].label, 'D3');
  assert.deepEqual(await call(hub, editor, { day: 3, label: 'D3', token }), { ok: true, unchanged: true, label: 'D3' });
  assert.equal(hub.saved.length, 1);
});

test('worker trip:setDayLabel rejects outsiders and invalid input without saving', async () => {
  const { hub, editor, viewer } = makeHub();
  hub.tripState = { ...hub.tripState, members: [{ id: 'u1' }, { id: 'u2' }] };
  const before = structuredClone(hub.tripState.days);

  const anon = await call(hub, editor, { day: 2, label: 'x' });
  assert.equal(anon.ok, false);
  const outsider = await call(hub, editor, { day: 2, label: 'x', token: await tokenFor('u3') });
  assert.equal(outsider.ok, false);
  assert.equal(outsider.error, '只有這趟行程的旅伴可以這樣做');

  const token = await tokenFor('u1');
  const long = await call(hub, editor, { day: 2, label: '🦊'.repeat(25), token });
  assert.equal(long.ok, false);
  assert.match(editor.events('error:edit').at(-1).error, /24/);
  assert.equal((await call(hub, editor, { day: 42, label: 'x', token })).ok, false);
  assert.equal((await call(hub, editor, { day: 2, label: 123, token })).ok, false);

  assert.deepEqual(hub.tripState.days, before);
  assert.equal(hub.saved.length, 0);
  assert.equal(viewer.events('trip:update').length, 0);
});
