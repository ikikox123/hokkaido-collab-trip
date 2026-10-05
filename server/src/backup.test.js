import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  BUCKET_ENV_VARS,
  BACKUP_INTERVAL_MS,
  createBackup,
  formatBackupId,
  listBackups,
  readBucketConfig,
  restoreBackup,
  runCli,
  startPeriodicBackup,
} from './backup.js';

const BUCKET = 'fixture-bucket';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hokkaido-backup-'));
}

function trip(updatedAt, title = '備份測試站') {
  return JSON.stringify({
    roomCode: 'TESTROOM',
    tripName: '備份測試',
    updatedAt,
    stops: [{ id: 'only-stop', title }],
    members: [],
    expenses: [],
    settlements: [],
  });
}

function users(name = 'tester') {
  return `${JSON.stringify({
    users: [{ id: 'u_test', username: name, displayName: name, passwordHash: 'hash' }],
  })}\n`;
}

function writeLive(dir, { state = trip('2026-06-02T00:00:00.000Z'), accounts = users(), when = '2026-02-02T02:02:02.000Z' } = {}) {
  const stateFile = path.join(dir, 'state.json');
  const usersFile = path.join(dir, 'users.json');
  fs.writeFileSync(stateFile, state);
  fs.writeFileSync(usersFile, accounts, { mode: 0o600 });
  const stamp = new Date(when);
  fs.utimesSync(stateFile, stamp, stamp);
  fs.utimesSync(usersFile, stamp, stamp);
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'keep');
  return { stateFile, usersFile };
}

function memoryBucket() {
  const objects = new Map();
  const calls = [];
  const keyOf = (bucket, key) => `${bucket}\0${key}`;
  return {
    objects,
    calls,
    async putObject({ bucket, key, body }) {
      calls.push(['put', bucket, key]);
      objects.set(keyOf(bucket, key), Buffer.from(body));
    },
    async getObject({ bucket, key }) {
      calls.push(['get', bucket, key]);
      const found = objects.get(keyOf(bucket, key));
      return found ? Buffer.from(found) : null;
    },
    async deleteObject({ bucket, key }) {
      calls.push(['delete', bucket, key]);
      objects.delete(keyOf(bucket, key));
    },
    async listObjects({ bucket, prefix }) {
      calls.push(['list', bucket, prefix]);
      const out = [];
      for (const id of objects.keys()) {
        const split = id.indexOf('\0');
        const objectBucket = id.slice(0, split);
        const key = id.slice(split + 1);
        if (objectBucket === bucket && key.startsWith(prefix)) out.push({ key });
      }
      return out;
    },
  };
}

function guardWrites(dir) {
  const root = path.resolve(dir);
  const blocked = new Set(['writeFileSync', 'appendFileSync', 'truncateSync', 'rmSync', 'renameSync', 'openSync', 'chmodSync', 'utimesSync', 'copyFileSync', 'mkdirSync', 'linkSync', 'symlinkSync', 'unlinkSync']);
  return new Proxy(fs, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (!blocked.has(prop)) return value.bind(target);
      return (...args) => {
        throw new Error(`refusing local write via ${String(prop)} under ${root}`);
      };
    },
  });
}

function snapshot(file) {
  const stat = fs.statSync(file);
  return { bytes: fs.readFileSync(file), ino: stat.ino, mtimeMs: stat.mtimeMs, size: stat.size, nlink: stat.nlink, mode: stat.mode & 0o777 };
}

test('formatBackupId is a sortable timestamp with no punctuation except T and Z', () => {
  assert.equal(formatBackupId(new Date('2026-08-01T01:02:03.004Z')), '20260801T010203004Z');
});

test('uploading a backup does not modify the live files or create a local backup directory', async () => {
  const dir = tempDir();
  const { stateFile, usersFile } = writeLive(dir);
  const beforeState = snapshot(stateFile);
  const beforeUsers = snapshot(usersFile);
  const client = memoryBucket();
  const realPut = client.putObject.bind(client);
  client.putObject = async (args) => {
    assert.equal(Buffer.isBuffer(args.body), true);
    if (args.key.endsWith('state.json')) args.body[0] = 0x58;
    return realPut(args);
  };
  try {
    const result = await createBackup({
      dataDir: dir,
      now: new Date('2026-08-01T00:00:00.000Z'),
      client,
      bucket: BUCKET,
      fsImpl: guardWrites(dir),
    });
    assert.equal(result.backupId, '20260801T000000000Z');
    assert.deepEqual(result.files, ['state.json', 'users.json']);
    assert.deepEqual(snapshot(stateFile), beforeState);
    assert.deepEqual(snapshot(usersFile), beforeUsers);
    assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
    assert.deepEqual(fs.readdirSync(dir).sort(), ['notes.txt', 'state.json', 'users.json']);
    const stateKey = `${BUCKET}\0backups/20260801T000000000Z/state.json`;
    const usersKey = `${BUCKET}\0backups/20260801T000000000Z/users.json`;
    assert.equal(client.objects.get(stateKey).equals(beforeState.bytes), false);
    assert.equal(client.objects.get(stateKey)[0], 0x58);
    assert.equal(client.objects.get(usersKey).equals(beforeUsers.bytes), true);
    assert.deepEqual(client.calls.filter((call) => call[0] === 'put').map((call) => call[2]), [
      'backups/20260801T000000000Z/state.json',
      'backups/20260801T000000000Z/users.json',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing or empty live file uploads nothing', async () => {
  const dir = tempDir();
  writeLive(dir);
  const client = memoryBucket();
  fs.rmSync(path.join(dir, 'users.json'));
  const stateBefore = fs.readFileSync(path.join(dir, 'state.json'));
  await assert.rejects(
    () => createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') }),
    (err) => err.code === 'BACKUP_MISSING',
  );
  fs.writeFileSync(path.join(dir, 'users.json'), ' \n');
  await assert.rejects(
    () => createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') }),
    (err) => err.code === 'BACKUP_EMPTY',
  );
  assert.equal(client.objects.size, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'state.json')).equals(stateBefore), true);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed second upload deletes the partial object and leaves the live files', async () => {
  const dir = tempDir();
  const { stateFile, usersFile } = writeLive(dir);
  const beforeState = snapshot(stateFile);
  const beforeUsers = snapshot(usersFile);
  const client = memoryBucket();
  const realPut = client.putObject.bind(client);
  client.putObject = async (args) => {
    if (args.key.endsWith('users.json')) throw new Error('disk full');
    return realPut(args);
  };
  await assert.rejects(
    () => createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') }),
    /disk full/,
  );
  assert.equal(client.objects.size, 0);
  assert.equal(client.calls.some((call) => call[0] === 'delete'), true);
  assert.deepEqual(snapshot(stateFile), beforeState);
  assert.deepEqual(snapshot(usersFile), beforeUsers);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore writes only the chosen backup and refuses an older or empty snapshot', async () => {
  const dir = tempDir();
  const olderAt = '2026-06-02T00:00:00.001Z';
  const newerAt = '2026-06-02T00:00:00.002Z';
  const { stateFile, usersFile } = writeLive(dir, { state: trip(olderAt, '第一份'), accounts: users('first') });
  const client = memoryBucket();
  await createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') });
  fs.writeFileSync(stateFile, trip(newerAt, '第二份'));
  fs.writeFileSync(usersFile, users('second'), { mode: 0o600 });
  await createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T01:00:00.000Z') });
  client.objects.set(`${BUCKET}\0backups/20260801T010000000Z/notes.txt`, Buffer.from('nope'));

  const liveBefore = snapshot(stateFile);
  const usersBefore = snapshot(usersFile);
  const writesBefore = client.calls.filter((call) => call[0] === 'put' || call[0] === 'delete').length;
  await assert.rejects(
    () => restoreBackup({
      dataDir: dir,
      backupId: '20260801T000000000Z',
      client,
      bucket: BUCKET,
      fsImpl: guardWrites(dir),
    }),
    (err) => err.code === 'RESTORE_OLDER' && /older than current updatedAt 2026-06-02T00:00:00.002Z/.test(err.message),
  );
  assert.deepEqual(snapshot(stateFile), liveBefore);
  assert.deepEqual(snapshot(usersFile), usersBefore);

  client.objects.set(`${BUCKET}\0backups/20260801T030000000Z/state.json`, Buffer.from(' \n'));
  client.objects.set(`${BUCKET}\0backups/20260801T030000000Z/users.json`, Buffer.from(users('empty-state')));
  await assert.rejects(
    () => restoreBackup({ dataDir: dir, backupId: '20260801T030000000Z', client, bucket: BUCKET, fsImpl: guardWrites(dir) }),
    (err) => err.code === 'RESTORE_EMPTY',
  );
  client.objects.set(`${BUCKET}\0backups/20260801T040000000Z/state.json`, Buffer.from(trip('2026-06-03T00:00:00.000Z', '空帳號')));
  client.objects.set(`${BUCKET}\0backups/20260801T040000000Z/users.json`, Buffer.alloc(0));
  await assert.rejects(
    () => restoreBackup({ dataDir: dir, backupId: '20260801T040000000Z', client, bucket: BUCKET, fsImpl: guardWrites(dir) }),
    (err) => err.code === 'RESTORE_EMPTY',
  );
  assert.deepEqual(snapshot(stateFile), liveBefore);

  fs.chmodSync(stateFile, 0o640);
  const restored = await restoreBackup({
    dataDir: dir,
    backupId: '20260801T010000000Z',
    client,
    bucket: BUCKET,
  });
  assert.deepEqual(restored.files, ['state.json', 'users.json']);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), trip(newerAt, '第二份'));
  assert.equal(fs.readFileSync(usersFile, 'utf8'), users('second'));
  assert.equal(fs.statSync(stateFile).mode & 0o777, 0o640);
  assert.equal(fs.readFileSync(path.join(dir, 'notes.txt'), 'utf8'), 'keep');
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['notes.txt', 'state.json', 'users.json']);
  assert.equal(client.calls.filter((call) => call[0] === 'put' || call[0] === 'delete').length, writesBefore);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore refuses a bad id, invalid json, and an unreadable current trip', async () => {
  const dir = tempDir();
  const { stateFile } = writeLive(dir, { state: trip('2026-06-02T00:00:00.000Z') });
  const client = memoryBucket();
  await createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') });
  const before = fs.readFileSync(stateFile);
  for (const backupId of ['../state.json', '20260801T000000000Z/../../etc/passwd', '', 'not-an-id']) {
    await assert.rejects(
      () => restoreBackup({ dataDir: dir, backupId, client, bucket: BUCKET, fsImpl: guardWrites(dir) }),
      (err) => err.code === 'RESTORE_BAD_ID',
    );
  }
  client.objects.set(`${BUCKET}\0backups/20260801T050000000Z/state.json`, Buffer.from(trip('2026-07-01T00:00:00.000Z')));
  client.objects.set(`${BUCKET}\0backups/20260801T050000000Z/users.json`, Buffer.from('{'));
  await assert.rejects(
    () => restoreBackup({ dataDir: dir, backupId: '20260801T050000000Z', client, bucket: BUCKET, fsImpl: guardWrites(dir) }),
    (err) => err.code === 'RESTORE_INVALID',
  );
  fs.writeFileSync(stateFile, '{');
  await assert.rejects(
    () => restoreBackup({ dataDir: dir, backupId: '20260801T000000000Z', client, bucket: BUCKET, fsImpl: guardWrites(dir) }),
    (err) => err.code === 'RESTORE_CURRENT',
  );
  assert.equal(fs.readFileSync(stateFile, 'utf8'), '{');
  assert.equal(before.equals(Buffer.from(trip('2026-06-02T00:00:00.000Z'))), true);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('restore can replace a missing current file with the chosen backup', async () => {
  const dir = tempDir();
  writeLive(dir, { state: trip('2026-06-02T00:00:00.000Z', '可還原') });
  const client = memoryBucket();
  await createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') });
  fs.rmSync(path.join(dir, 'state.json'));
  await restoreBackup({ dataDir: dir, backupId: '20260801T000000000Z', client, bucket: BUCKET });
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).stops[0].title, '可還原');
  assert.equal(fs.readdirSync(dir).includes('backups'), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a failed rename leaves the live files and no temp file', async () => {
  const dir = tempDir();
  const { stateFile, usersFile } = writeLive(dir, { state: trip('2026-06-02T00:00:00.000Z', '線上') });
  const client = memoryBucket();
  await createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') });
  fs.writeFileSync(stateFile, trip('2026-06-01T00:00:00.000Z', '較舊線上'));
  const beforeState = fs.readFileSync(stateFile);
  const beforeUsers = fs.readFileSync(usersFile);
  let renames = 0;
  const fsImpl = new Proxy(fs, {
    get(target, prop) {
      const value = target[prop];
      if (typeof value !== 'function') return value;
      if (prop !== 'renameSync') return value.bind(target);
      return (src, dest) => {
        renames += 1;
        if (renames === 1) throw new Error('rename failed');
        return target.renameSync(src, dest);
      };
    },
  });
  await assert.rejects(
    () => restoreBackup({ dataDir: dir, backupId: '20260801T000000000Z', client, bucket: BUCKET, fsImpl }),
    /rename failed/,
  );
  assert.equal(fs.readFileSync(stateFile).equals(beforeState), true);
  assert.equal(fs.readFileSync(usersFile).equals(beforeUsers), true);
  assert.equal(fs.readdirSync(dir).some((name) => name.includes('restore-tmp')), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('listBackups returns complete timestamped copies newest first', async () => {
  const dir = tempDir();
  writeLive(dir, { state: trip('2026-06-01T00:00:00.000Z') });
  const client = memoryBucket();
  await createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T00:00:00.000Z') });
  fs.writeFileSync(path.join(dir, 'state.json'), trip('2026-06-02T00:00:00.000Z'));
  await createBackup({ dataDir: dir, client, bucket: BUCKET, now: new Date('2026-08-01T02:00:00.000Z') });
  client.objects.set(`${BUCKET}\0backups/20260801T020000000Z/extra.json`, Buffer.from('{}'));
  client.objects.set(`${BUCKET}\0backups/not-a-backup/state.json`, Buffer.from(trip('2026-01-01T00:00:00.000Z')));
  client.objects.set(`${BUCKET}\0backups/20260801T090000000Z/state.json`, Buffer.from(trip('2026-09-01T00:00:00.000Z')));
  const listed = await listBackups({ client, bucket: BUCKET });
  assert.deepEqual(listed, [
    { backupId: '20260801T020000000Z', updatedAt: '2026-06-02T00:00:00.000Z' },
    { backupId: '20260801T000000000Z', updatedAt: '2026-06-01T00:00:00.000Z' },
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('periodic copies upload on start and on the schedule, then stop', async () => {
  const dir = tempDir();
  writeLive(dir, { state: trip('2026-06-02T00:00:00.000Z') });
  const client = memoryBucket();
  const times = [
    new Date('2026-08-01T00:00:00.000Z'),
    new Date('2026-08-01T01:00:00.000Z'),
    new Date('2026-08-01T02:00:00.000Z'),
  ];
  let n = 0;
  let scheduled = null;
  const handle = startPeriodicBackup({
    dataDir: dir,
    client,
    bucket: BUCKET,
    intervalMs: 1234,
    now: () => times[Math.min(n++, times.length - 1)],
    schedule(fn, intervalMs) {
      assert.equal(intervalMs, 1234);
      scheduled = fn;
      return () => {
        scheduled = null;
      };
    },
    createClient() {
      throw new Error('real bucket client must not be created');
    },
  });
  assert.equal(handle.started, true);
  const first = await handle.whenStarted;
  assert.equal(first.backupId, '20260801T000000000Z');
  await scheduled();
  assert.equal(client.objects.has(`${BUCKET}\0backups/20260801T010000000Z/state.json`), true);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  const pending = scheduled;
  handle.stop();
  assert.equal(scheduled, null);
  await pending();
  assert.equal(client.objects.has(`${BUCKET}\0backups/20260801T020000000Z/state.json`), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a periodic copy that cannot read the live files does not stop the loop', async () => {
  const dir = tempDir();
  const client = memoryBucket();
  const errors = [];
  const handle = startPeriodicBackup({
    dataDir: dir,
    client,
    bucket: BUCKET,
    schedule: () => () => {},
    onError: (err) => errors.push(err),
    createClient() {
      throw new Error('real bucket client must not be created');
    },
  });
  assert.equal(await handle.whenStarted, null);
  assert.equal(handle.started, true);
  assert.equal(errors[0].code, 'BACKUP_MISSING');
  assert.equal(client.objects.size, 0);
  assert.equal(fs.existsSync(path.join(dir, 'backups')), false);
  handle.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('periodic copies stay off unless the Railway bucket variables are set', async () => {
  let scheduled = false;
  const handle = startPeriodicBackup({
    env: {
      AWS_ACCESS_KEY_ID: 'aws-key',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      AWS_REGION: 'us-east-1',
      AWS_ENDPOINT_URL: 'https://example.invalid',
      S3_BUCKET: 'other-bucket',
    },
    schedule() {
      scheduled = true;
      return () => {};
    },
    createClient() {
      throw new Error('real bucket client must not be created');
    },
  });
  assert.equal(handle.started, false);
  assert.equal(scheduled, false);
  assert.deepEqual(handle.missing, [...BUCKET_ENV_VARS]);
  assert.equal(JSON.stringify(handle).includes('aws-secret'), false);

  const messages = [];
  const code = await runCli(['node', 'backup.js', 'backup'], {
    env: {
      ENDPOINT: 'http://example.invalid',
      REGION: 'auto',
      BUCKET: 'fixture-bucket',
      ACCESS_KEY_ID: 'test-access-key',
      SECRET_ACCESS_KEY: 'test-secret-key',
    },
    createClient() {
      throw new Error('real bucket client must not be created');
    },
    stderr: (line) => messages.push(line),
  });
  assert.equal(code, 1);
  assert.match(messages.join('\n'), /ENDPOINT must be an https URL/);
  assert.equal(messages.join('\n').includes('test-secret-key'), false);
  assert.equal(messages.join('\n').includes('test-access-key'), false);
});

test('readBucketConfig accepts only the five Railway bucket variables', () => {
  const config = readBucketConfig({
    ENDPOINT: 'https://example.invalid',
    REGION: 'auto',
    BUCKET: 'fixture-bucket',
    ACCESS_KEY_ID: 'test-access-key',
    SECRET_ACCESS_KEY: 'test-secret-key',
  });
  assert.equal(config.ok, true);
  assert.equal(config.bucket, 'fixture-bucket');
  assert.equal(config.endpoint, 'https://example.invalid');
  assert.equal(BACKUP_INTERVAL_MS, 60 * 60 * 1000);
});

test('cli backup and restore use the injected client and a temp directory', async () => {
  const dir = tempDir();
  writeLive(dir, { state: trip('2026-06-02T00:00:00.000Z', '指令') });
  const client = memoryBucket();
  const lines = [];
  const code = await runCli(['node', 'backup.js', 'backup'], {
    dataDir: dir,
    client,
    bucket: BUCKET,
    now: new Date('2026-08-01T00:00:00.000Z'),
    stdout: (line) => lines.push(line),
  });
  assert.equal(code, 0);
  assert.deepEqual(lines, ['20260801T000000000Z']);
  fs.writeFileSync(path.join(dir, 'state.json'), trip('2026-06-01T00:00:00.000Z', '較舊'));
  const restored = [];
  const restoreCode = await runCli(['node', 'backup.js', 'restore', '--id', '20260801T000000000Z'], {
    dataDir: dir,
    client,
    bucket: BUCKET,
    stdout: (line) => restored.push(line),
  });
  assert.equal(restoreCode, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')).stops[0].title, '指令');
  const listed = [];
  assert.equal(await runCli(['node', 'backup.js', 'list'], {
    dataDir: dir,
    client,
    bucket: BUCKET,
    stdout: (line) => listed.push(line),
  }), 0);
  assert.deepEqual(listed, ['20260801T000000000Z 2026-06-02T00:00:00.000Z']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the image build does not copy the data directory', () => {
  const dockerfile = fs.readFileSync(path.join(repoRoot, 'Dockerfile'), 'utf8');
  const copies = dockerfile.split('\n').filter((line) => /^\s*COPY\b/.test(line));
  assert.equal(copies.some((line) => /\bdata\b/.test(line)), false);
  const ignore = fs.readFileSync(path.join(repoRoot, '.dockerignore'), 'utf8');
  assert.match(ignore, /^data$/m);
  const source = fs.readFileSync(path.join(repoRoot, 'server/src/index.js'), 'utf8');
  assert.match(source, /startPeriodicBackup\(\{ dataDir: DATA_DIR \}\)/);
});
