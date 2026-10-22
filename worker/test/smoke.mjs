// End-to-end check against a running `wrangler dev` (default http://127.0.0.1:8787).
// Usage: node test/smoke.mjs [baseUrl]
import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:8787';
const wsUrl = base.replace(/^http/, 'ws') + '/ws';

async function api(path, init = {}) {
  const res = await fetch(base + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers || {}) },
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function client() {
  const ws = new WebSocket(wsUrl);
  const events = [];
  const waiters = [];
  const acks = new Map();
  let n = 1;
  ws.onmessage = (e) => {
    if (e.data === 'pong') return events.push({ event: 'pong' });
    const msg = JSON.parse(e.data);
    if (msg.t === 'ack') return acks.get(msg.id)?.(msg.data);
    events.push(msg);
    for (const w of [...waiters]) if (w.test(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg.data); }
  };
  return {
    ready: new Promise((r) => (ws.onopen = r)),
    emit(event, data) {
      const id = n++;
      ws.send(JSON.stringify({ t: 'emit', event, data, ack: id }));
      return new Promise((resolve, reject) => {
        acks.set(id, resolve);
        setTimeout(() => reject(new Error(`no ack for ${event}`)), 8000);
      });
    },
    next(event, pred = () => true) {
      return new Promise((resolve, reject) => {
        waiters.push({ test: (m) => m.event === event && pred(m.data), resolve });
        setTimeout(() => reject(new Error(`no ${event}`)), 8000);
      });
    },
    ping: () => ws.send('ping'),
    events,
    close: () => ws.close(),
  };
}

const health = await api('/api/health');
assert.equal(health.body.runtime, 'workers');

const bad = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'nope' }) });
assert.equal(bad.status, 401);

const login = await api('/api/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'demo1234' }) });
assert.equal(login.status, 200, JSON.stringify(login.body));
const token = login.body.token;

const me = await api('/api/me', { headers: { authorization: `Bearer ${token}` } });
assert.equal(me.body.user.username, 'alice');

const share = await api('/api/share');
assert.ok(share.body.stops.length > 0);

const name = `smoke${Date.now().toString(36)}`;
const reg = await api('/api/register', { method: 'POST', body: JSON.stringify({ username: name, password: 'pass1234' }) });
assert.equal(reg.status, 201, JSON.stringify(reg.body));
assert.match(reg.body.user.id, /^u_[0-9a-f]{16}$/);

const a = client();
const b = client();
await Promise.all([a.ready, b.ready]);

const anon = await a.emit('room:join', { roomCode: 'HOKKAIDO2027' });
assert.equal(anon.ok, false);

const firstTrip = a.next('trip:update');
assert.deepEqual(await a.emit('room:join', { roomCode: 'HOKKAIDO2027', token }), { ok: true });
const trip = await firstTrip;
assert.ok(trip.members.some((m) => m.id === reg.body.user.id), 'registered user auto-joined');

const presence = a.next('presence:update', (p) => p.count === 2);
assert.deepEqual(await b.emit('room:join', { roomCode: 'HOKKAIDO2027', token: reg.body.token }), { ok: true });
await presence;

const day = trip.days[0].day;
const added = b.next('trip:update', (t) => t.stops.some((s) => s.title === 'Smoke stop'));
a.emit('trip:add', { stop: { day, title: 'Smoke stop', lat: 43.06, lng: 141.35 }, token }).catch(() => {});
const afterAdd = await added;

const expenseSeen = b.next('trip:update', (t) => t.expenses.some((e) => e.note === 'Smoke ramen'));
const exp = await a.emit('expense:upsert', {
  expense: { note: 'Smoke ramen', amount: '2400', currency: 'JPY', payerId: 'u1', mode: 'equal', memberIds: ['u1', reg.body.user.id] },
  token,
});
assert.equal(exp.ok, true, exp.error);
await expenseSeen;

const forbidden = await b.emit('trip:reset', { token: 'garbage' });
assert.equal(forbidden.ok, false);

const left = a.next('presence:update', (p) => p.count === 1);
b.close();
await left;

a.ping();
await new Promise((r) => setTimeout(r, 300));
assert.ok(a.events.some((e) => e.event === 'pong'), 'auto ping/pong');
a.close();

const stop = afterAdd.stops.find((s) => s.title === 'Smoke stop');
console.log('smoke ok', { stops: afterAdd.stops.length, newStop: stop.id, expense: exp.ok });
