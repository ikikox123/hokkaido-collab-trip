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

test('registered id stays the same across restart and demo ids stay u1 and u2', async () => {
  const { dir, dataFile, store } = tempStore();
  try {
    await store.init();
    const created = await store.register({ username: ' Mika ', password: 'trip2027' });
    assert.equal(created.ok, true);
    assert.match(created.user.id, /^u_[0-9a-f]{16}$/);
    assert.notEqual(created.user.id, 'u1');
    assert.notEqual(created.user.id, 'u2');
    assert.equal(created.user.username, 'mika');
    assert.equal(created.user.displayName, 'Mika');
    const rawBefore = fs.readFileSync(dataFile, 'utf8');

    const reloaded = createUserStore({ dataFile, rounds: 4 });
    await reloaded.init();
    assert.equal(fs.readFileSync(dataFile, 'utf8'), rawBefore);
    const login = await reloaded.authenticate('mika', 'trip2027');
    assert.equal(login.ok, true);
    assert.equal(login.user.id, created.user.id);
    assert.equal(login.user.username, 'mika');
    assert.equal(login.user.displayName, 'Mika');
    const alice = await reloaded.authenticate('alice', 'demo1234');
    const bob = await reloaded.authenticate('bob', 'demo1234');
    assert.equal(alice.user.id, 'u1');
    assert.equal(alice.user.displayName, 'Alice');
    assert.equal(bob.user.id, 'u2');
    assert.equal(bob.user.displayName, 'Bob');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('registration leaves an existing HOKKAIDO2027 state file unchanged', async () => {
  const { dir, dataFile, store } = tempStore();
  const stateFile = path.join(dir, 'state.json');
  const original = '{"roomCode":"HOKKAIDO2027","stops":[{"id":"s9","title":"小樽運河"}]}';
  try {
    fs.writeFileSync(stateFile, original);
    await store.init();
    const created = await store.register({ username: 'mika', password: 'trip2027' });
    assert.equal(created.ok, true);
    assert.equal(fs.readFileSync(stateFile, 'utf8'), original);
    const saved = fs.readFileSync(dataFile, 'utf8');
    assert.equal(saved.includes('小樽運河'), false);
    assert.equal(saved.includes('HOKKAIDO2027'), false);
    assert.equal(saved.includes('trip2027'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('account store refuses to open the trip state file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-users-'));
  const stateFile = path.join(dir, 'state.json');
  const original = '{"roomCode":"HOKKAIDO2027","stops":[{"id":"s1","title":"既有站點"}]}';
  try {
    fs.writeFileSync(stateFile, original);
    const store = createUserStore({ dataFile: stateFile, rounds: 4 });
    await assert.rejects(() => store.init(), /行程狀態檔/);
    await assert.rejects(
      () => store.register({ username: 'mika', password: 'trip2027' }),
      /行程狀態檔/,
    );
    assert.equal(fs.readFileSync(stateFile, 'utf8'), original);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('publicById returns the account id without a password hash', async () => {
  const { dir, dataFile, store } = tempStore();
  try {
    await store.init();
    const created = await store.register({ username: 'mika', password: 'trip2027' });
    assert.equal(created.ok, true);
    const raw = fs.readFileSync(dataFile, 'utf8');
    const alice = store.publicById('u1');
    const bob = store.publicById('u2');
    const mika = store.publicById(created.user.id);
    assert.deepEqual(alice, { id: 'u1', username: 'alice', displayName: 'Alice' });
    assert.deepEqual(bob, { id: 'u2', username: 'bob', displayName: 'Bob' });
    assert.equal(mika.id, created.user.id);
    assert.match(mika.id, /^u_[0-9a-f]{16}$/);
    assert.equal(mika.username, 'mika');
    assert.equal(mika.passwordHash, undefined);
    assert.equal(store.publicById('nobody'), null);
    assert.equal(fs.readFileSync(dataFile, 'utf8'), raw);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function productionStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-users-prod-'));
  const dataFile = path.join(dir, 'users.json');
  const store = createUserStore({ dataFile, rounds: 4, nodeEnv: 'production' });
  return { dir, dataFile, store };
}

function captureConsole(fn) {
  const logs = [];
  const warns = [];
  const log = console.log;
  const warn = console.warn;
  console.log = (...args) => logs.push(args.map(String).join(' '));
  console.warn = (...args) => warns.push(args.map(String).join(' '));
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = log;
      console.warn = warn;
    })
    .then(() => ({ logs, warns }));
}

test('production boot does not create alice or bob', async () => {
  const { dir, dataFile, store } = productionStore();
  try {
    await store.init();
    assert.equal(fs.existsSync(dataFile), false);
    assert.equal((await store.authenticate('alice', 'demo1234')).ok, false);
    assert.equal((await store.authenticate('bob', 'demo1234')).ok, false);
    assert.equal(store.publicById('u1'), null);
    assert.equal(store.publicById('u2'), null);
    await store.planProductionDemoRemoval([]).commit();
    assert.equal(fs.existsSync(dataFile), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('production refuses registration of alice and bob; dev does not reserve them', async () => {
  const { dir, dataFile, store } = productionStore();
  const dev = tempStore();
  try {
    await store.init();
    for (const username of ['alice', 'Alice', 'ALICE', 'bob', ' Bob ', 'BOB']) {
      const blocked = await store.register({ username, password: 'fresh-pass' });
      assert.equal(blocked.ok, false, username);
      assert.equal(blocked.status, 400, username);
      assert.equal(blocked.error, '這個帳號名稱不能使用', username);
    }
    assert.equal(fs.existsSync(dataFile), false);
    const nearby = await store.register({ username: 'alice2', password: 'fresh-pass' });
    assert.equal(nearby.ok, true);
    assert.equal(nearby.user.username, 'alice2');

    await dev.store.init();
    const taken = await dev.store.register({ username: 'Alice', password: 'secret1' });
    assert.equal(taken.ok, false);
    assert.equal(taken.status, 409);
    assert.equal(taken.error, '這個帳號已經有人使用');
    const alice = await dev.store.authenticate('alice', 'demo1234');
    const bob = await dev.store.authenticate('bob', 'demo1234');
    assert.equal(alice.ok, true);
    assert.equal(alice.user.id, 'u1');
    assert.equal(bob.ok, true);
    assert.equal(bob.user.id, 'u2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(dev.dir, { recursive: true, force: true });
  }
});

test('production users.json drops only demo alice and bob', async () => {
  const { dir, dataFile, store } = productionStore();
  const hash = {
    alice: 'HASHALICE-do-not-leak',
    bob: 'HASHBOB-do-not-leak',
    dagg: 'HASHDAGG-keep-me',
    yutin: 'HASHYUTIN-keep-me',
    shuiii: 'HASHSHUIII-keep-me',
    alice2: 'HASHALICE2-keep-me',
    aliceCase: 'HASHALICECASE-keep-me',
    later: 'HASHLATER-keep-me',
  };
  const laterId = 'u_0123456789abcdef';
  const original = {
    users: [
      { id: 'u1', username: 'alice', displayName: 'Alice', passwordHash: hash.alice },
      { id: 'u2', username: 'bob', displayName: 'Bob', passwordHash: hash.bob },
      { id: 'u_dagg', username: 'DAGG', displayName: 'DAGG', passwordHash: hash.dagg },
      { id: 'u_yutin', username: 'yutin', displayName: 'yutin', passwordHash: hash.yutin },
      { id: 'u_shuiii', username: 'shuiii', displayName: 'shuiii', passwordHash: hash.shuiii },
      { id: 'not-reg', username: 'alice2', displayName: 'alice2', passwordHash: hash.alice2 },
      { id: 'u-case', username: 'Alice', displayName: 'Alice Case', passwordHash: hash.aliceCase },
      { id: laterId, username: 'bob', displayName: 'Later Bob', passwordHash: hash.later },
    ],
  };
  try {
    fs.writeFileSync(dataFile, `${JSON.stringify(original, null, 2)}\n`);
    const { logs, warns } = await captureConsole(async () => {
      await store.init();
      const removal = store.planProductionDemoRemoval([]);
      assert.equal((await store.authenticate('alice', 'demo1234')).ok, false);
      assert.equal(fs.readFileSync(dataFile, 'utf8').includes(hash.alice), true);
      await removal.commit();
    });
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.deepEqual(
      saved.users.map((user) => user.username),
      ['DAGG', 'yutin', 'shuiii', 'alice2', 'Alice', 'bob'],
    );
    const byId = Object.fromEntries(saved.users.map((user) => [user.id, user]));
    assert.equal(byId.u_dagg.passwordHash, hash.dagg);
    assert.equal(byId.u_dagg.id, 'u_dagg');
    assert.equal(byId.u_dagg.username, 'DAGG');
    assert.equal(byId.u_yutin.passwordHash, hash.yutin);
    assert.equal(byId.u_yutin.id, 'u_yutin');
    assert.equal(byId.u_shuiii.passwordHash, hash.shuiii);
    assert.equal(byId.u_shuiii.id, 'u_shuiii');
    assert.equal(byId['not-reg'].passwordHash, hash.alice2);
    assert.equal(byId['u-case'].passwordHash, hash.aliceCase);
    assert.equal(byId['u-case'].username, 'Alice');
    assert.equal(byId[laterId].passwordHash, hash.later);
    assert.equal(byId[laterId].id, laterId);
    assert.equal(byId[laterId].username, 'bob');
    assert.equal(saved.users.some((user) => user.id === 'u1' || user.id === 'u2'), false);
    const joined = `${logs.join('\n')}\n${warns.join('\n')}`;
    assert.match(logs.join('\n'), /removed 2: alice, bob/);
    assert.equal(joined.includes(hash.dagg), false);
    assert.equal(joined.includes(hash.alice), false);
    assert.equal(joined.includes('DAGG'), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('production keeps alice when that account is already a companion', async () => {
  const { dir, dataFile, store } = productionStore();
  const hash = { alice: 'HASHALICE-companion', bob: 'HASHBOB-remove', dagg: 'HASHDAGG-stay' };
  try {
    fs.writeFileSync(
      dataFile,
      `${JSON.stringify({
        users: [
          { id: 'u1', username: 'alice', displayName: 'Alice', passwordHash: hash.alice },
          { id: 'u2', username: 'bob', displayName: 'Bob', passwordHash: hash.bob },
          { id: 'u_dagg', username: 'DAGG', displayName: 'DAGG', passwordHash: hash.dagg },
        ],
      }, null, 2)}\n`,
    );
    const { logs, warns } = await captureConsole(async () => {
      await store.init();
      await store.planProductionDemoRemoval(['u1']).commit();
    });
    const saved = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    assert.deepEqual(
      saved.users.map((user) => user.id),
      ['u1', 'u_dagg'],
    );
    assert.equal(saved.users[0].passwordHash, hash.alice);
    assert.equal(saved.users[0].username, 'alice');
    assert.equal(saved.users[1].passwordHash, hash.dagg);
    assert.match(warns.join('\n'), /alice is on the companion list/);
    assert.match(logs.join('\n'), /removed 1: bob/);
    assert.equal(`${logs.join('\n')}\n${warns.join('\n')}`.includes(hash.alice), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('production does not rewrite users.json when nothing is removed or the file cannot be read', async () => {
  const { dir, dataFile, store } = productionStore();
  const intact = `${JSON.stringify({
    users: [{ id: 'u_dagg', username: 'DAGG', displayName: 'DAGG', passwordHash: 'HASHDAGG-intact' }],
  }, null, 2)}\n`;
  try {
    fs.writeFileSync(dataFile, intact);
    await store.init();
    await store.planProductionDemoRemoval([]).commit();
    assert.equal(fs.readFileSync(dataFile, 'utf8'), intact);

    fs.writeFileSync(dataFile, '{');
    const broken = createUserStore({ dataFile, rounds: 4, nodeEnv: 'production' });
    await broken.init();
    await broken.planProductionDemoRemoval([]).commit();
    assert.equal(fs.readFileSync(dataFile, 'utf8'), '{');

    fs.rmSync(dataFile);
    const missing = createUserStore({ dataFile, rounds: 4, nodeEnv: 'production' });
    await missing.init();
    await missing.planProductionDemoRemoval([]).commit();
    assert.equal(fs.existsSync(dataFile), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dev boot still seeds alice and bob and does not rewrite users.json', async () => {
  const { dir, dataFile, store } = tempStore();
  const raw = `${JSON.stringify({
    users: [
      { id: 'u1', username: 'alice', displayName: 'Hacker', passwordHash: 'HASHALICE-file' },
      { id: 'u_dagg', username: 'DAGG', displayName: 'DAGG', passwordHash: 'HASHDAGG-file' },
    ],
  }, null, 2)}\n`;
  try {
    fs.writeFileSync(dataFile, raw);
    await store.init();
    await store.planProductionDemoRemoval([]).commit();
    assert.equal(fs.readFileSync(dataFile, 'utf8'), raw);
    const alice = await store.authenticate('alice', 'demo1234');
    assert.equal(alice.ok, true);
    assert.equal(alice.user.id, 'u1');
    assert.equal(alice.user.displayName, 'Alice');
    const bob = await store.authenticate('bob', 'demo1234');
    assert.equal(bob.ok, true);
    assert.equal(bob.user.id, 'u2');
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
