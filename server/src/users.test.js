import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createUserStore } from './users.js';

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-users-'));
  const dataFile = path.join(dir, 'users.json');
  const store = createUserStore({ dataFile, rounds: 4 });
  return { dir, dataFile, store };
}

test('demo accounts alice and bob still log in with demo1234', async () => {
  const { dir, store } = tempStore();
  try {
    await store.init();
    for (const username of ['alice', 'bob', 'Alice', 'BOB']) {
      const result = await store.authenticate(username, 'demo1234');
      assert.equal(result.ok, true, username);
      assert.equal(result.user.username, username.toLowerCase());
    }
    const wrong = await store.authenticate('alice', 'nope');
    assert.equal(wrong.ok, false);
    assert.equal(wrong.status, 401);
    assert.equal(wrong.error, '帳號或密碼錯誤');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('register persists a login-able account without storing the password', async () => {
  const { dir, dataFile, store } = tempStore();
  try {
    await store.init();
    const created = await store.register({ username: ' 小明 ', password: 'trip-2027' });
    assert.equal(created.ok, true);
    assert.equal(created.status, 201);
    assert.equal(created.user.username, '小明');
    assert.equal(created.user.displayName, '小明');
    assert.equal(created.user.passwordHash, undefined);

    const raw = fs.readFileSync(dataFile, 'utf8');
    assert.equal(raw.includes('trip-2027'), false);
    assert.equal(raw.includes('demo1234'), false);
    assert.equal(raw.includes('alice'), false);
    assert.match(raw, /passwordHash/);

    const reloaded = createUserStore({ dataFile, rounds: 4 });
    await reloaded.init();
    const login = await reloaded.authenticate('小明', 'trip-2027');
    assert.equal(login.ok, true);
    assert.equal(login.user.displayName, '小明');
    const demo = await reloaded.authenticate('alice', 'demo1234');
    assert.equal(demo.ok, true);
    assert.equal(demo.user.id, 'u1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('duplicate usernames, including demo accounts and different case, are rejected', async () => {
  const { dir, store } = tempStore();
  try {
    await store.init();
    const first = await store.register({ username: 'Carol', password: 'secret1' });
    assert.equal(first.ok, true);

    const again = await store.register({ username: 'carol', password: 'secret2' });
    assert.equal(again.ok, false);
    assert.equal(again.status, 409);
    assert.equal(again.error, '這個帳號已經有人使用');

    for (const username of ['alice', 'Alice', ' bob ']) {
      const taken = await store.register({ username, password: 'secret1' });
      assert.equal(taken.ok, false, username);
      assert.equal(taken.status, 409);
      assert.equal(taken.error, '這個帳號已經有人使用');
    }

    const demo = await store.authenticate('alice', 'demo1234');
    assert.equal(demo.ok, true);
    const carol = await store.authenticate('Carol', 'secret1');
    assert.equal(carol.ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('empty username or password returns a specific message', async () => {
  const { dir, store } = tempStore();
  try {
    await store.init();
    const cases = [
      [{ username: '', password: '' }, '請輸入帳號與密碼'],
      [{ username: '   ', password: '   ' }, '請輸入帳號與密碼'],
      [{ username: '', password: 'secret1' }, '請輸入帳號'],
      [{ username: '   ', password: 'secret1' }, '請輸入帳號'],
      [{ username: 'carol', password: '' }, '請輸入密碼'],
      [{ username: 'carol', password: '   ' }, '請輸入密碼'],
      [{}, '請輸入帳號與密碼'],
    ];
    for (const [body, message] of cases) {
      const registered = await store.register(body);
      assert.equal(registered.ok, false, message);
      assert.equal(registered.status, 400);
      assert.equal(registered.error, message);
      const loggedIn = await store.authenticate(body.username, body.password);
      assert.equal(loggedIn.ok, false, message);
      assert.equal(loggedIn.status, 400);
      assert.equal(loggedIn.error, message);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a saved demo username cannot replace alice or bob', async () => {
  const { dir, dataFile, store } = tempStore();
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      dataFile,
      JSON.stringify({
        users: [
          {
            id: 'u1',
            username: 'alice',
            displayName: 'Hacker',
            passwordHash: '$2a$04$abcdefghijklmnopqrstuu012345678901234567890123456789012',
          },
        ],
      }),
    );
    await store.init();
    const login = await store.authenticate('alice', 'demo1234');
    assert.equal(login.ok, true);
    assert.equal(login.user.displayName, 'Alice');
    assert.equal(login.user.id, 'u1');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('failed save does not leave a half-registered account', async () => {
  const { dir, dataFile, store } = tempStore();
  try {
    fs.mkdirSync(dataFile);
    await store.init();
    const result = await store.register({ username: 'zoe', password: 'secret1' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.equal(result.error, '註冊沒有成功，請稍後再試');
    const login = await store.authenticate('zoe', 'secret1');
    assert.equal(login.ok, false);
    assert.equal(login.status, 401);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
