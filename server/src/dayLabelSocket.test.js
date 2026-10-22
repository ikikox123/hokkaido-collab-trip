import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(new URL('../../client/package.json', import.meta.url));
const { io } = require('socket.io-client');

const serverEntry = fileURLToPath(new URL('./index.js', import.meta.url));

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

function waitEvent(socket, event, pred = () => true, ms = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    function handler(payload) {
      if (!pred(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
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

async function login(base, username) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'demo1234' }),
  });
  assert.equal(res.status, 200);
  return res.json();
}

const STOPS = [
  { id: 's1', day: 1, date: '2027-02-12', title: '新千歲機場', time: '15:00', notes: '', lat: 42.78, lng: 141.68 },
  { id: 's2', day: 2, date: '2027-02-13', title: '札幌時計台', time: '10:00', notes: '集合', lat: 43.06, lng: 141.35 },
];

test('trip:setDayLabel checks membership, validates, broadcasts, and persists only the label', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-daylabel-'));
  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(stateFile, JSON.stringify({
    roomCode: 'HOKKAIDO2027',
    tripName: '測試行程',
    lodging: { name: 'Stay', address: 'Addr', lat: 43.06, lng: 141.35 },
    flights: { outbound: 'a', inbound: 'b' },
    days: [
      { day: 1, date: '2027-02-12', label: 'D1 抵達' },
      { day: 2, date: '2027-02-13', label: 'D2 札幌' },
    ],
    stops: STOPS,
    members: [{ id: 'u1' }],
    expenses: [],
    settlements: [],
  }));

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = '';
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port), TRIP_DATA_DIR: dir, NODE_ENV: 'development', JWT_SECRET: 'test-day-label' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.disconnect();
    if (child.exitCode == null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000).then(() => child.kill('SIGKILL'))]);
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

  const alice = await login(base, 'alice');
  const bob = await login(base, 'bob');

  const editor = io(base, { transports: ['websocket'], reconnection: false });
  const viewer = io(base, { transports: ['websocket'], reconnection: false });
  const outsider = io(base, { transports: ['websocket'], reconnection: false });
  sockets.push(editor, viewer, outsider);
  const editorFirst = waitEvent(editor, 'trip:update');
  const viewerFirst = waitEvent(viewer, 'trip:update');
  editor.emit('room:join', { roomCode: 'HOKKAIDO2027', token: alice.token });
  viewer.emit('room:join', { roomCode: 'HOKKAIDO2027', token: alice.token });
  await Promise.all([editorFirst, viewerFirst]);
  if (!outsider.connected) await waitEvent(outsider, 'connect');

  // Not logged in, and logged in but not a companion.
  const anon = await emitAck(outsider, 'trip:setDayLabel', { day: 2, label: '偷改' });
  assert.equal(anon.ok, false);
  const notMember = await emitAck(outsider, 'trip:setDayLabel', { day: 2, label: '偷改', token: bob.token });
  assert.equal(notMember.ok, false);
  assert.equal(notMember.error, '只有這趟行程的旅伴可以這樣做');

  // Rename: trimmed, broadcast to the other socket, written to disk.
  const seen = waitEvent(viewer, 'trip:update', (trip) => trip.days?.[1]?.label === '札幌 雪祭り');
  const renamed = await emitAck(editor, 'trip:setDayLabel', { day: 2, label: '  札幌   雪祭り ', token: alice.token });
  assert.deepEqual(renamed, { ok: true, label: '札幌 雪祭り' });
  const broadcast = await seen;
  assert.equal(broadcast.days[0].label, 'D1 抵達');
  const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(saved.days[1].label, '札幌 雪祭り');
  assert.equal(saved.days[0].label, 'D1 抵達');
  assert.deepEqual(
    saved.stops.map(({ id, day, title, time, lat, lng }) => ({ id, day, title, time, lat, lng })),
    STOPS.map(({ id, day, title, time, lat, lng }) => ({ id, day, title, time, lat, lng })),
  );

  // Same text again is a no-op.
  assert.deepEqual(await emitAck(editor, 'trip:setDayLabel', { day: 2, label: '札幌 雪祭り', token: alice.token }), {
    ok: true,
    unchanged: true,
    label: '札幌 雪祭り',
  });

  // Too long or unknown day: rejected, nothing saved.
  const editError = waitEvent(editor, 'error:edit');
  const tooLong = await emitAck(editor, 'trip:setDayLabel', { day: 2, label: '雪'.repeat(25), token: alice.token });
  assert.equal(tooLong.ok, false);
  assert.match((await editError).error, /24/);
  const missing = await emitAck(editor, 'trip:setDayLabel', { day: 9, label: 'x', token: alice.token });
  assert.equal(missing.ok, false);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).days[1].label, '札幌 雪祭り');

  // Blank resets to D{n}.
  const reset = waitEvent(viewer, 'trip:update', (trip) => trip.days?.[1]?.label === 'D2');
  assert.deepEqual(await emitAck(editor, 'trip:setDayLabel', { day: 2, label: '   ', token: alice.token }), { ok: true, label: 'D2' });
  await reset;
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).days[1].label, 'D2');
});
