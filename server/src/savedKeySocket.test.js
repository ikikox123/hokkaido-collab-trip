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

const KEY = `hks_0123456789abcdef_${'A'.repeat(43)}`;
const KEY_ERROR = '這把金鑰只能用來收藏';

test('a saved-places key on a socket gets the key-only message, never the login-expired flow', { timeout: 30000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-keysock-'));
  const port = await freePort();
  let log = '';
  const child = spawn(process.execPath, [serverEntry], {
    env: { ...process.env, PORT: String(port), TRIP_DATA_DIR: dir, NODE_ENV: 'development', JWT_SECRET: 'test-key-socket' },
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
    child.stdout.on('data', () => {
      if (!log.includes('[server] listening')) return;
      clearTimeout(timer);
      resolve();
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`server exited ${code}\n${log}`));
    });
  });

  const socket = io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
  sockets.push(socket);
  if (!socket.connected) await waitEvent(socket, 'connect');
  const events = [];
  socket.on('session:required', () => events.push('session:required'));
  socket.on('error:auth', (e) => events.push(e.error));

  const join = await emitAck(socket, 'room:join', { roomCode: 'HOKKAIDO2027', token: KEY });
  assert.deepEqual(join, { ok: false, error: KEY_ERROR });
  const edit = await emitAck(socket, 'trip:setDayLabel', { day: 1, label: 'x', token: KEY });
  assert.deepEqual(edit, { ok: false, error: KEY_ERROR });
  await delay(100);
  assert.ok(!events.includes('session:required'), 'must not trigger the logout flow');
  assert.ok(events.includes(KEY_ERROR));
  assert.ok(!events.includes('登入已過期'));

  // A real expired / forged login still takes the old path.
  const forged = await emitAck(socket, 'room:join', { roomCode: 'HOKKAIDO2027', token: 'not.a.jwt' });
  assert.equal(forged.error, '登入已過期');
});
