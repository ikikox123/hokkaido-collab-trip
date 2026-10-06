import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const require = createRequire(new URL('../../client/package.json', import.meta.url));
const { io } = require('socket.io-client');
const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));
const ROOM = 'HOKKAIDO2027';
const HOST_ID = 'u_bbbbbbbbbbbbbbbb';
const LATE_ID = 'u_aaaaaaaaaaaaaaaa';

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

function tripBody(members) {
  return {
    roomCode: ROOM,
    tripName: '測試行程',
    lodging: { name: 'Stay', address: 'Addr', lat: 43.1, lng: 141.3 },
    days: [{ day: 1, date: '2027-02-12', label: 'D1' }],
    stops: [{ id: 's9', day: 1, date: '2027-02-12', title: '小樽運河', time: '10:00', lat: 43.2, lng: 141.0 }],
    members,
    expenses: [{ id: 'e1', note: 'keep-ledger', payerId: 'u1' }],
    settlements: [{ id: 'st1', payerId: 'u1', payeeId: 'u2', amount: 10 }],
    fx: { quote: { twdPerJpy: 0.21 }, override: null, stale: false, error: null },
  };
}

async function startServer(t, { nodeEnv, members, users }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-autojoin-'));
  const stateFile = path.join(dir, 'state.json');
  const original = tripBody(members);
  fs.writeFileSync(stateFile, JSON.stringify(original));
  if (users) fs.writeFileSync(path.join(dir, 'users.json'), users);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    PORT: String(port),
    TRIP_DATA_DIR: dir,
    NODE_ENV: nodeEnv,
    JWT_SECRET: 'autojoin-test-secret',
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
    original,
    sockets,
    log: () => log,
    saved() {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    },
    connect() {
      const socket = io(base, { transports: ['websocket'], reconnection: false });
      sockets.push(socket);
      return socket;
    },
  };
}

async function postJson(url, body, headers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function assertLedgerUntouched(saved, original) {
  assert.deepEqual(saved.stops, original.stops);
  assert.deepEqual(saved.expenses, original.expenses);
  assert.deepEqual(saved.settlements, original.settlements);
  assert.deepEqual(saved.members[0], original.members[0]);
}

function memberIds(saved) {
  return saved.members.map((member) => member.id);
}

test('register and login add a companion once without rewriting the trip', { timeout: 30000 }, async (t) => {
  const lateHash = bcrypt.hashSync('late-pass', 4);
  const hostHash = bcrypt.hashSync('host-pass', 4);
  const users = `${JSON.stringify({
    users: [
      { id: HOST_ID, username: 'host', displayName: '主辦', passwordHash: hostHash },
      { id: LATE_ID, username: 'late', displayName: 'Late', passwordHash: lateHash },
    ],
  }, null, 2)}\n`;
  const server = await startServer(t, {
    nodeEnv: 'development',
    members: [{ id: HOST_ID, displayName: '主辦' }],
    users,
  });

  const anon = await fetch(`${server.base}/api/trip`);
  assert.equal(anon.status, 401);

  const alice = await postJson(`${server.base}/api/login`, { username: 'alice', password: 'demo1234' });
  assert.equal(alice.status, 200);
  const aliceTrip = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${alice.data.token}` },
  });
  assert.equal(aliceTrip.status, 403);
  assert.deepEqual(memberIds(server.saved()), [HOST_ID]);

  const late = await postJson(`${server.base}/api/login`, { username: 'late', password: 'late-pass' });
  assert.equal(late.status, 200);
  const lateView = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${late.data.token}` },
  });
  assert.equal(lateView.status, 200);
  const lateBody = await lateView.json();
  assert.equal(lateBody.stops[0].title, '小樽運河');
  assert.equal(lateBody.expenses[0].note, 'keep-ledger');
  assert.ok(lateBody.members.some((member) => member.username === 'late' && member.id === LATE_ID));
  let saved = server.saved();
  assert.deepEqual(memberIds(saved), [HOST_ID, LATE_ID]);
  assert.deepEqual(saved.members[1], { id: LATE_ID });
  assertLedgerUntouched(saved, server.original);

  const lateAgain = await postJson(`${server.base}/api/login`, { username: 'late', password: 'late-pass' });
  assert.equal(lateAgain.status, 200);
  assert.deepEqual(memberIds(server.saved()), [HOST_ID, LATE_ID]);

  const host = await postJson(`${server.base}/api/login`, { username: 'host', password: 'host-pass' });
  assert.equal(host.status, 200);
  const sock = server.connect();
  const firstTrip = waitEvent(sock, 'trip:update');
  await onceConnected(sock);
  const joined = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for room:join ack')), 4000);
    sock.emit('room:join', { roomCode: ROOM, token: host.data.token }, (result) => {
      clearTimeout(timer);
      resolve(result);
    });
  });
  assert.equal(joined.ok, true);
  await firstTrip;

  const seenPromise = waitEvent(sock, 'trip:update');
  const created = await postJson(`${server.base}/api/register`, { username: ' Mika ', password: 'trip2027' });
  assert.equal(created.status, 201);
  assert.match(created.data.user.id, /^u_[0-9a-f]{16}$/);
  const seen = await seenPromise;
  assert.ok(seen.members.some((member) => member.username === 'mika'));
  const mikaView = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${created.data.token}` },
  });
  assert.equal(mikaView.status, 200);
  const mikaBody = await mikaView.json();
  assert.equal(mikaBody.stops[0].title, '小樽運河');
  assert.equal(mikaBody.roomCode, ROOM);
  saved = server.saved();
  const mikaId = created.data.user.id;
  assert.deepEqual(memberIds(saved), [HOST_ID, LATE_ID, mikaId]);
  assert.deepEqual(saved.members[2], { id: mikaId });
  assertLedgerUntouched(saved, server.original);
  assert.equal(JSON.stringify(saved).includes('trip2027'), false);

  const duplicate = await postJson(`${server.base}/api/register`, { username: 'mika', password: 'another-pass' });
  assert.equal(duplicate.status, 409);
  const loggedIn = await postJson(`${server.base}/api/login`, { username: 'mika', password: 'trip2027' });
  assert.equal(loggedIn.status, 200);
  const loggedInAgain = await postJson(`${server.base}/api/login`, { username: 'Mika', password: 'trip2027' });
  assert.equal(loggedInAgain.status, 200);
  saved = server.saved();
  assert.deepEqual(memberIds(saved), [HOST_ID, LATE_ID, mikaId]);
  assertLedgerUntouched(saved, server.original);
  assert.equal(server.log().includes('trip2027'), false);
  assert.equal(server.log().includes('late-pass'), false);
});

test('production rejects alice and bob and still auto-joins other accounts', { timeout: 30000 }, async (t) => {
  const server = await startServer(t, {
    nodeEnv: 'production',
    members: [{ id: HOST_ID, displayName: '主辦' }],
  });
  const anon = await fetch(`${server.base}/api/trip`);
  assert.equal(anon.status, 401);
  const stale = jwt.sign({ id: 'u1', username: 'alice', displayName: 'Alice' }, 'autojoin-test-secret');
  const missing = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${stale}` },
  });
  assert.equal(missing.status, 401);
  assert.equal(server.log().includes('demo users alice/bob'), false);

  for (const username of ['alice', 'Alice', 'bob', ' Bob ']) {
    const blocked = await postJson(
      `${server.base}/api/register`,
      { username, password: 'fresh-pass' },
      { 'x-forwarded-for': '198.51.100.10' },
    );
    assert.equal(blocked.status, 400, username);
    assert.equal(blocked.data.error, '這個帳號名稱不能使用');
  }
  assert.equal(fs.existsSync(path.join(server.dir, 'users.json')), false);
  assert.deepEqual(server.saved().members, [{ id: HOST_ID, displayName: '主辦' }]);

  const created = await postJson(
    `${server.base}/api/register`,
    { username: 'mika', password: 'trip2027' },
    { 'x-forwarded-for': '198.51.100.20' },
  );
  assert.equal(created.status, 201);
  const view = await fetch(`${server.base}/api/trip`, {
    headers: { authorization: `Bearer ${created.data.token}` },
  });
  assert.equal(view.status, 200);
  const again = await postJson(
    `${server.base}/api/login`,
    { username: 'mika', password: 'trip2027' },
    { 'x-forwarded-for': '198.51.100.20' },
  );
  assert.equal(again.status, 200);
  const duplicate = await postJson(
    `${server.base}/api/register`,
    { username: 'mika', password: 'trip2027' },
    { 'x-forwarded-for': '198.51.100.20' },
  );
  assert.equal(duplicate.status, 409);
  const saved = server.saved();
  assert.deepEqual(saved.members.map((member) => member.id), [HOST_ID, created.data.user.id]);
  assert.deepEqual(saved.members[1], { id: created.data.user.id });
  assertLedgerUntouched(saved, server.original);
  const storedUsers = JSON.parse(fs.readFileSync(path.join(server.dir, 'users.json'), 'utf8'));
  assert.deepEqual(storedUsers.users.map((user) => user.username), ['mika']);
  assert.equal(JSON.stringify(storedUsers).includes('trip2027'), false);
});

test('the same IP can register five accounts an hour and the sixth is refused', { timeout: 60000 }, async (t) => {
  const server = await startServer(t, {
    nodeEnv: 'development',
    members: [{ id: HOST_ID, displayName: '主辦' }],
  });
  const ip = { 'x-forwarded-for': '203.0.113.10' };
  const ids = [];
  for (let i = 1; i <= 5; i += 1) {
    const created = await postJson(
      `${server.base}/api/register`,
      { username: `traveler${i}`, password: 'trip2027' },
      ip,
    );
    assert.equal(created.status, 201, `traveler${i}`);
    ids.push(created.data.user.id);
  }
  const blocked = await postJson(
    `${server.base}/api/register`,
    { username: 'traveler6', password: 'trip2027' },
    ip,
  );
  assert.equal(blocked.status, 429);
  assert.equal(blocked.data.error, '註冊太多次，請一小時後再試');
  const other = await postJson(
    `${server.base}/api/register`,
    { username: 'traveler7', password: 'trip2027' },
    { 'x-forwarded-for': '203.0.113.11' },
  );
  assert.equal(other.status, 201);
  const saved = server.saved();
  assert.deepEqual(saved.members.map((member) => member.id), [HOST_ID, ...ids, other.data.user.id]);
  for (const member of saved.members.slice(1)) assert.deepEqual(Object.keys(member), ['id']);
  assertLedgerUntouched(saved, server.original);
  const stored = fs.readFileSync(path.join(server.dir, 'users.json'), 'utf8');
  assert.equal(stored.includes('traveler6'), false);
  assert.equal(stored.includes('203.0.113.10'), false);
  assert.equal(JSON.stringify(saved).includes('203.0.113.10'), false);

  const stillLogsIn = await postJson(
    `${server.base}/api/login`,
    { username: 'traveler1', password: 'trip2027' },
    ip,
  );
  assert.equal(stillLogsIn.status, 200);
  assert.deepEqual(server.saved().members.map((member) => member.id), [HOST_ID, ...ids, other.data.user.id]);
});
