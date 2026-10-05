import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../client/package.json', import.meta.url));
const { io } = require('socket.io-client');

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const FORBIDDEN_KEYS = [
  'members',
  'username',
  'userId',
  'expenses',
  'settlements',
  'fx',
  'flights',
  'roomCode',
  'legs',
  'password',
  'passwordHash',
  'token',
  'updatedAt',
];

function collectKeys(value, found = new Set()) {
  if (!value || typeof value !== 'object') return found;
  if (Array.isArray(value)) {
    for (const item of value) collectKeys(item, found);
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    collectKeys(child, found);
  }
  return found;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function onceConnected(socket) {
  if (socket.connected) return Promise.resolve();
  return waitEvent(socket, 'connect');
}

function waitEvent(socket, event, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event} ack`)), 4000);
    socket.emit(event, payload, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
}

async function postJson(url, body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = await res.json();
  return { status: res.status, data };
}

test('public share, private trip, sealed sockets, and member adds', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-access-'));
  const port = 21000 + (process.pid % 20000);
  const base = `http://127.0.0.1:${port}`;
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({
    roomCode: 'HOKKAIDO2027',
    tripName: '測試行程',
    lodging: { name: 'Stay', address: 'Addr', lat: 43.1, lng: 141.3, secret: 'lodging-secret' },
    flights: { outbound: 'secret-flight', inbound: 'secret-return' },
    days: [{ day: 1, date: '2027-02-12', label: 'D1', hidden: 'day-secret' }],
    stops: [{
      id: 's1',
      day: 1,
      date: '2027-02-12',
      title: '札幌時計台',
      time: '10:00',
      notes: '集合',
      lat: 43.2,
      lng: 141.4,
      secret: 'stop-secret',
    }],
    members: [],
    expenses: [{ id: 'e1', note: 'secret expense', payerId: 'u1' }],
    settlements: [{ id: 'st1', payerId: 'u1', payeeId: 'u2' }],
    fx: { quote: { twdPerJpy: 0.21 } },
    legs: [{ id: 'leg1', summary: 'hidden leg' }],
    username: 'alice',
    updatedAt: '2020-01-01T00:00:00.000Z',
  }));

  let log = '';
  const child = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      PORT: String(port),
      TRIP_DATA_DIR: dir,
      NODE_ENV: 'development',
      JWT_SECRET: 'test-share-secret',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        delay(2000).then(() => child.kill('SIGKILL')),
      ]);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`server did not listen\n${log}`)), 15000);
    const check = () => {
      if (!log.includes('[server] listening')) return;
      clearTimeout(timer);
      resolve();
    };
    child.stdout.on('data', check);
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${log}`));
    });
    check();
  });

  const shareRes = await fetch(`${base}/api/share`);
  assert.equal(shareRes.status, 200);
  const share = await shareRes.json();
  const keys = collectKeys(share);
  for (const key of FORBIDDEN_KEYS) assert.equal(keys.has(key), false, key);
  const shareBody = JSON.stringify(share);
  for (const needle of ['alice', 'bob', 'u1', 'secret', 'expense', 'flight']) {
    assert.equal(shareBody.includes(needle), false, needle);
  }
  assert.equal(share.tripName, '測試行程');
  assert.equal(share.stops[0].title, '札幌時計台');
  assert.deepEqual(Object.keys(share).sort(), ['days', 'lodging', 'stops', 'tripName']);

  const anon = await fetch(`${base}/api/trip`);
  assert.equal(anon.status, 401);
  const bad = await fetch(`${base}/api/trip`, { headers: { authorization: 'Bearer not-a-token' } });
  assert.equal(bad.status, 401);

  const alice = await postJson(`${base}/api/login`, { username: 'alice', password: 'demo1234' });
  const bob = await postJson(`${base}/api/login`, { username: 'bob', password: 'demo1234' });
  const cara = await postJson(`${base}/api/register`, { username: 'cara', password: 'secret123' });
  assert.equal(alice.status, 200);
  assert.equal(bob.status, 200);
  assert.equal(cara.status, 201);

  const authed = await fetch(`${base}/api/trip`, { headers: { authorization: `Bearer ${alice.data.token}` } });
  assert.equal(authed.status, 200);
  const privateTrip = await authed.json();
  assert.ok(Array.isArray(privateTrip.members));
  assert.ok(Array.isArray(privateTrip.expenses));

  const guestEvents = [];
  const guest = io(base, { transports: ['websocket'], reconnection: false });
  sockets.push(guest);
  guest.on('trip:update', () => guestEvents.push('trip:update'));
  guest.on('fx:update', () => guestEvents.push('fx:update'));
  await onceConnected(guest);
  guest.emit('room:join', {
    roomCode: 'HOKKAIDO2027',
    user: { id: 'u1', username: 'alice', displayName: 'Alice' },
  });
  await delay(400);
  assert.deepEqual(guestEvents, []);

  const aliceSock = io(base, { transports: ['websocket'], reconnection: false });
  const bobSock = io(base, { transports: ['websocket'], reconnection: false });
  const caraSock = io(base, { transports: ['websocket'], reconnection: false });
  sockets.push(aliceSock, bobSock, caraSock);
  const aliceTrip = waitEvent(aliceSock, 'trip:update');
  const bobTrip = waitEvent(bobSock, 'trip:update');
  const caraTrip = waitEvent(caraSock, 'trip:update');
  await Promise.all([onceConnected(aliceSock), onceConnected(bobSock), onceConnected(caraSock)]);
  aliceSock.emit('room:join', { roomCode: 'HOKKAIDO2027', token: alice.data.token });
  bobSock.emit('room:join', { roomCode: 'HOKKAIDO2027', token: bob.data.token });
  caraSock.emit('room:join', { roomCode: 'HOKKAIDO2027', token: cara.data.token });
  const visible = await aliceTrip;
  assert.ok(Array.isArray(visible.members));
  assert.ok(Array.isArray(visible.expenses));
  await bobTrip;
  await caraTrip;
  assert.deepEqual(guestEvents, []);

  const denied = waitEvent(caraSock, 'error:auth');
  caraSock.emit('trip:updateStop', { id: 's1', patch: { title: '被改掉', secret: 'nope' }, token: cara.data.token });
  const deniedBody = await denied;
  assert.equal(deniedBody.error, '只有這趟行程的旅伴可以這樣做');
  const still = await (await fetch(`${base}/api/share`)).json();
  assert.equal(still.stops[0].title, '札幌時計台');

  const outsider = await emitAck(bobSock, 'trip:addMember', { username: 'cara', token: bob.data.token });
  assert.equal(outsider.ok, false);
  assert.equal(outsider.error, '只有這趟行程的旅伴可以這樣做');

  const self = await emitAck(aliceSock, 'trip:addMember', { username: 'alice', token: alice.data.token });
  assert.equal(self.ok, true);
  const addedBob = await emitAck(aliceSock, 'trip:addMember', { username: 'bob', token: alice.data.token });
  assert.equal(addedBob.ok, true);
  await delay(200);
  assert.deepEqual(guestEvents, []);

  const after = await (await fetch(`${base}/api/trip`, {
    headers: { authorization: `Bearer ${alice.data.token}` },
  })).json();
  const names = after.members.map((member) => member.username).sort();
  assert.deepEqual(names, ['alice', 'bob']);
  const publicAfter = JSON.stringify(await (await fetch(`${base}/api/share`)).json());
  assert.equal(publicAfter.includes('alice'), false);
  assert.equal(publicAfter.includes('bob'), false);
  assert.equal(publicAfter.includes('cara'), false);
});
