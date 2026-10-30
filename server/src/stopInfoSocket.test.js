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

// A state file written before opening hours existed: no `hours`, and notes only on some stops.
const STOPS = [
  { id: 's1', day: 1, date: '2027-02-12', title: '新千歲機場', time: '15:00', notes: '', lat: 42.78, lng: 141.68 },
  { id: 's2', day: 2, date: '2027-02-13', title: '札幌時計台', time: '10:00', lat: 43.06, lng: 141.35 },
];

test('trip:updateStop hours/notes: members only, validated, broadcast, persisted; legacy stops stay as they were', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-stopinfo-'));
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
  const readStops = () => JSON.parse(fs.readFileSync(stateFile, 'utf8')).stops;

  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let log = '';
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port), TRIP_DATA_DIR: dir, NODE_ENV: 'development', JWT_SECRET: 'test-stop-info' },
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
  sockets.push(editor, viewer);
  const first = Promise.all([waitEvent(editor, 'trip:update'), waitEvent(viewer, 'trip:update')]);
  editor.emit('room:join', { roomCode: 'HOKKAIDO2027', token: alice.token });
  viewer.emit('room:join', { roomCode: 'HOKKAIDO2027', token: alice.token });
  const [loaded] = await first;
  // Legacy stops load without gaining fields.
  assert.equal('hours' in loaded.stops.find((s) => s.id === 's2'), false);
  assert.equal('notes' in loaded.stops.find((s) => s.id === 's2'), false);

  // Not a companion: rejected, nothing written.
  const denied = await emitAck(viewer, 'trip:updateStop', { id: 's2', patch: { hours: 'x' }, token: bob.token });
  assert.equal(denied.ok, false);
  assert.equal('hours' in readStops()[1], false);

  // An unrelated edit does not add the new keys.
  assert.deepEqual(await emitAck(editor, 'trip:updateStop', { id: 's2', patch: { time: '11:00' }, token: alice.token }), { ok: true });
  assert.equal(readStops()[1].time, '11:00');
  assert.equal('hours' in readStops()[1], false);
  assert.equal('notes' in readStops()[1], false);

  // Set both: cleaned, broadcast, persisted.
  const seen = waitEvent(viewer, 'trip:update', (trip) => trip.stops.find((s) => s.id === 's2')?.hours);
  const set = await emitAck(editor, 'trip:updateStop', {
    id: 's2',
    patch: { hours: ' 08:45 – 17:10‮ ', notes: ' 週一休\n\n 免費參觀 ' },
    token: alice.token,
  });
  assert.deepEqual(set, { ok: true });
  const pushed = (await seen).stops.find((s) => s.id === 's2');
  assert.equal(pushed.hours, '08:45 – 17:10');
  assert.equal(pushed.notes, '週一休\n免費參觀');
  assert.deepEqual(readStops()[1], { ...STOPS[1], time: '11:00', hours: '08:45 – 17:10', notes: '週一休\n免費參觀' });
  assert.deepEqual(readStops()[0], STOPS[0], 'other stops are untouched');

  // Same value again is a no-op; invalid input is rejected and nothing is saved.
  assert.deepEqual(await emitAck(editor, 'trip:updateStop', { id: 's2', patch: { hours: '08:45 – 17:10' }, token: alice.token }), { ok: true, unchanged: true });
  const errored = waitEvent(editor, 'error:edit');
  const tooLong = await emitAck(editor, 'trip:updateStop', { id: 's2', patch: { hours: 'x'.repeat(81) }, token: alice.token });
  assert.equal(tooLong.ok, false);
  assert.match((await errored).error, /80/);
  assert.equal((await emitAck(editor, 'trip:updateStop', { id: 's2', patch: { notes: 'a\nb\nc\nd' }, token: alice.token })).ok, false);
  assert.equal(readStops()[1].hours, '08:45 – 17:10');

  // Empty removes the key.
  const cleared = waitEvent(viewer, 'trip:update', (trip) => !('hours' in trip.stops.find((s) => s.id === 's2')));
  assert.deepEqual(await emitAck(editor, 'trip:updateStop', { id: 's2', patch: { hours: '', notes: '  ' }, token: alice.token }), { ok: true });
  await cleared;
  assert.deepEqual(readStops()[1], { ...STOPS[1], time: '11:00' });

  // Adding a stop with hours.
  const added = waitEvent(viewer, 'trip:update', (trip) => trip.stops.some((s) => s.hours === '10:00-21:00'));
  editor.emit('trip:add', { stop: { day: 2, title: '新店', time: '12:00', lat: 43.05, lng: 141.34, hours: '10:00-21:00', notes: '' }, token: alice.token });
  const addedStop = (await added).stops.find((s) => s.hours === '10:00-21:00');
  assert.equal('notes' in addedStop, false);

  // Opening-hours endpoint needs a login and a companion.
  assert.equal((await fetch(`${base}/api/opening-hours?name=x&lat=43&lng=141`)).status, 401);
  assert.equal((await fetch(`${base}/api/opening-hours?name=x&lat=43&lng=141`, { headers: { Authorization: `Bearer ${bob.token}` } })).status, 403);
  assert.equal((await fetch(`${base}/api/opening-hours?lat=43&lng=141`, { headers: { Authorization: `Bearer ${alice.token}` } })).status, 400);
});
