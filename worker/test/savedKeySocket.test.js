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

const SECRET = 'worker-key-socket-secret';
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

const KEY = `hks_0123456789abcdef_${'A'.repeat(43)}`;
const KEY_ERROR = '這把金鑰只能用來收藏';

test('worker: a saved-places key over the WebSocket gets the key-only message, never session:required', async () => {
  const { hub, editor } = makeHub();
  for (const [name, payload] of [
    ['room:join', { roomCode: 'HOKKAIDO2027', token: KEY }],
    ['trip:setDayLabel', { day: 2, label: 'x', token: KEY }],
  ]) {
    let result;
    await hub.handlers[name].call(hub, editor, payload, (data) => (result = data));
    assert.deepEqual(result, { ok: false, error: KEY_ERROR }, name);
  }
  assert.equal(editor.events('session:required').length, 0);
  assert.equal(editor.events('error:auth').filter((e) => e.error === KEY_ERROR).length, 2);
  assert.equal(editor.events('error:auth').filter((e) => e.error === '登入已過期').length, 0);
  assert.equal(hub.saved.length, 0);

  // A forged / expired login keeps the old behaviour.
  let forged;
  await hub.handlers['room:join'].call(hub, editor, { roomCode: 'HOKKAIDO2027', token: 'not.a.jwt' }, (data) => (forged = data));
  assert.equal(forged.error, '登入已過期');
  assert.equal(editor.events('session:required').length, 1);
});
