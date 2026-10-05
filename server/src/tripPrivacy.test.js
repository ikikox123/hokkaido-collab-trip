import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { NOT_COMPANION_ERROR } from './memberAccess.js';

const require = createRequire(new URL('../../client/package.json', import.meta.url));
const { io } = require('socket.io-client');
const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const ROOM = 'HOKKAIDO2027';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => (err ? reject(err) : resolve(port)));
    });
    server.on('error', reject);
  });
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

function tripBody(members) {
  return {
    roomCode: ROOM,
    tripName: '測試行程',
    lodging: { name: 'Stay', address: 'Addr', lat: 43.1, lng: 141.3 },
    days: [{ day: 1, date: '2027-02-12', label: 'D1' }],
    stops: [{
      id: 's1',
      day: 1,
      date: '2027-02-12',
      title: '札幌時計台',
      time: '10:00',
      lat: 43.2,
      lng: 141.4,
      notes: '集合',
    }],
    members,
    expenses: [],
    settlements: [],
    fx: { quote: { twdPerJpy: 0.21 } },
  };
}

async function startServer(t, { members, nodeEnv, users, jwtSecret = 'privacy-test-secret' }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-privacy-'));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(tripBody(members)));
  if (users) fs.writeFileSync(path.join(dir, 'users.json'), users);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    TRIP_DATA_DIR: dir,
    NODE_ENV: nodeEnv,
    JWT_SECRET: jwtSecret,
  };
  for (const name of ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY']) {
    delete env[name];
  }
  let log = '';
  const child = spawn(process.execPath, [serverEntry], {
    env,
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
  return {
    dir,
    base,
    sockets,
    log: () => log,
    connect() {
      const socket = io(base, { transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      return socket;
    },
  };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

test('companions can read the trip and other logged-in accounts cannot', { timeout: 30000 }, async (t) => {
  const server = await startServer(t, { members: [{ id: 'u2' }], nodeEnv: 'development' });
  const anon = await fetch(`${server.base}/api/trip`);
  assert.equal(anon.status, 401);
  const share = await (await fetch(`${server.base}/api/share`)).json();
  assert.equal(share.tripName, '測試行程');
  assert.equal(Object.hasOwn(share, 'members'), false);
  assert.equal(Object.hasOwn(share, 'expenses'), false);

  const alice = await postJson(`${server.base}/api/login`, { username: 'alice', password: 'demo1234' });
  const bob = await postJson(`${server.base}/api/login`, { username: 'bob', password: 'demo1234' });
  assert.equal(alice.status, 200);
  assert.equal(bob.status, 200);

  const denied = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${alice.data.token}` },
  });
  assert.equal(denied.status, 403);
  assert.equal((await denied.json()).error, NOT_COMPANION_ERROR);

  const aliceSock = server.connect();
  const aliceEvents = [];
  aliceSock.on('trip:update', () => aliceEvents.push('trip:update'));
  aliceSock.on('fx:update', () => aliceEvents.push('fx:update'));
  aliceSock.on('presence:update', () => aliceEvents.push('presence:update'));
  await onceConnected(aliceSock);
  const aliceAck = await emitAck(aliceSock, 'room:join', { roomCode: ROOM, token: alice.data.token });
  assert.equal(aliceAck.ok, false);
  assert.equal(aliceAck.error, NOT_COMPANION_ERROR);
  await delay(400);
  assert.deepEqual(aliceEvents, []);

  const allowed = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${bob.data.token}` },
  });
  assert.equal(allowed.status, 200);
  const bobView = await allowed.json();
  assert.ok(Array.isArray(bobView.members));
  assert.ok(Array.isArray(bobView.expenses));

  const bobSock = server.connect();
  const bobTrip = waitEvent(bobSock, 'trip:update');
  await onceConnected(bobSock);
  const bobAck = await emitAck(bobSock, 'room:join', { roomCode: ROOM, token: bob.data.token });
  assert.equal(bobAck.ok, true);
  const visible = await bobTrip;
  assert.equal(visible.stops[0].title, '札幌時計台');
  await delay(200);
  assert.deepEqual(aliceEvents, []);

  const added = await emitAck(bobSock, 'member:add', { username: 'alice', token: bob.data.token });
  assert.equal(added.ok, true);
  await delay(200);
  assert.deepEqual(aliceEvents, []);

  const aliceAgain = server.connect();
  const aliceTrip = waitEvent(aliceAgain, 'trip:update');
  await onceConnected(aliceAgain);
  const againAck = await emitAck(aliceAgain, 'room:join', { roomCode: ROOM, token: alice.data.token });
  assert.equal(againAck.ok, true);
  const joined = await aliceTrip;
  assert.ok(joined.members.some((member) => member.username === 'alice'));

  const leaked = [];
  aliceAgain.on('trip:update', () => leaked.push('trip:update'));
  aliceAgain.on('fx:update', () => leaked.push('fx:update'));
  aliceAgain.on('presence:update', () => leaked.push('presence:update'));
  const kicked = waitEvent(aliceAgain, 'companion:required');
  const removed = await emitAck(bobSock, 'member:remove', { id: 'u1', token: bob.data.token });
  assert.equal(removed.ok, true);
  const kick = await kicked;
  assert.equal(kick.error, NOT_COMPANION_ERROR);
  await delay(300);
  assert.deepEqual(leaked, []);
  const after = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${alice.data.token}` },
  });
  assert.equal(after.status, 403);
  const bobStill = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${bob.data.token}` },
  });
  assert.equal(bobStill.status, 200);
});

test('an empty companion list lets a logged-in account read the trip', { timeout: 30000 }, async (t) => {
  const server = await startServer(t, { members: [], nodeEnv: 'development' });
  const alice = await postJson(`${server.base}/api/login`, { username: 'alice', password: 'demo1234' });
  assert.equal(alice.status, 200);
  const res = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${alice.data.token}` },
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.members));
  assert.equal(body.members.length, 0);
  assert.equal(body.stops[0].title, '札幌時計台');

  const sock = server.connect();
  const trip = waitEvent(sock, 'trip:update');
  await onceConnected(sock);
  const ack = await emitAck(sock, 'room:join', { roomCode: ROOM, token: alice.data.token });
  assert.equal(ack.ok, true);
  const update = await trip;
  assert.equal(update.stops[0].title, '札幌時計台');
});

test('production drops demo alice and a stale credential cannot read the trip', { timeout: 30000 }, async (t) => {
  const aliceHash = bcrypt.hashSync('demo1234', 4);
  const hostHash = bcrypt.hashSync('host-pass', 4);
  const hostId = 'u_0123456789abcdef';
  const users = `${JSON.stringify({
    users: [
      { id: 'u1', username: 'alice', displayName: 'Alice', passwordHash: aliceHash },
      { id: 'u2', username: 'bob', displayName: 'Bob', passwordHash: aliceHash },
      { id: hostId, username: 'DAGG', displayName: 'DAGG', passwordHash: hostHash },
    ],
  }, null, 2)}\n`;
  const secret = 'privacy-test-secret';
  const server = await startServer(t, {
    members: [{ id: hostId }],
    nodeEnv: 'production',
    users,
    jwtSecret: secret,
  });
  const stale = jwt.sign({ id: 'u1', username: 'alice', displayName: 'Alice' }, secret);
  const denied = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${stale}` },
  });
  assert.equal(denied.status, 401);
  const login = await postJson(`${server.base}/api/login`, { username: 'alice', password: 'demo1234' });
  assert.equal(login.status, 401);

  const sock = server.connect();
  const events = [];
  sock.on('trip:update', () => events.push('trip:update'));
  sock.on('fx:update', () => events.push('fx:update'));
  sock.on('presence:update', () => events.push('presence:update'));
  await onceConnected(sock);
  const ack = await emitAck(sock, 'room:join', { roomCode: ROOM, token: stale });
  assert.equal(ack.ok, false);
  await delay(400);
  assert.deepEqual(events, []);

  const host = await postJson(`${server.base}/api/login`, { username: 'DAGG', password: 'host-pass' });
  assert.equal(host.status, 200);
  const hostTrip = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${host.data.token}` },
  });
  assert.equal(hostTrip.status, 200);

  const usersFile = path.join(server.dir, 'users.json');
  let raw = '';
  for (let i = 0; i < 20; i += 1) {
    raw = fs.readFileSync(usersFile, 'utf8');
    if (!raw.includes(aliceHash) && raw.includes(hostHash)) break;
    await delay(100);
  }
  const saved = JSON.parse(raw);
  assert.deepEqual(saved.users.map((user) => user.id), [hostId]);
  assert.equal(saved.users[0].passwordHash, hostHash);
  assert.equal(saved.users[0].username, 'DAGG');
  assert.equal(server.log().includes('demo1234'), false);
  assert.equal(server.log().includes('alice/bob'), false);
});
