/**
 * Periodic copies of the two live data files to a Railway bucket.
 * Reads data/state.json and data/users.json and uploads those bytes.
 * The copy does not write those files, and it does not create a local backup directory.
 * Restore writes only those two files, and only from the chosen backup id.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createS3BackupClient } from './s3BackupClient.js';

export const LIVE_FILES = ['state.json', 'users.json'];
export const BUCKET_ENV_VARS = ['ENDPOINT', 'REGION', 'BUCKET', 'ACCESS_KEY_ID', 'SECRET_ACCESS_KEY'];
/** Object-key prefix inside the bucket. This is not a directory on the data volume. */
export const BACKUP_KEY_PREFIX = 'backups';
export const BACKUP_INTERVAL_MS = 60 * 60 * 1000;
const BACKUP_ID_RE = /^\d{8}T\d{9}Z$/;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function stringValue(value) {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname !== '';
  } catch {
    return false;
  }
}

/**
 * Credentials and the bucket location come only from these environment variables.
 * Returns ok:false when any required variable is missing. Failure results do not
 * include the values.
 */
export function readBucketConfig(env = process.env) {
  const source = env && typeof env === 'object' ? env : {};
  const missing = BUCKET_ENV_VARS.filter((name) => stringValue(source[name]) === '');
  if (missing.length > 0) {
    return { ok: false, missing, reason: `missing ${missing.join(', ')}` };
  }
  const endpoint = stringValue(source.ENDPOINT);
  if (!isHttpsUrl(endpoint)) {
    return { ok: false, missing: [], reason: 'ENDPOINT must be an https URL' };
  }
  return {
    ok: true,
    missing: [],
    endpoint,
    region: stringValue(source.REGION),
    bucket: stringValue(source.BUCKET),
    accessKeyId: stringValue(source.ACCESS_KEY_ID),
    secretAccessKey: stringValue(source.SECRET_ACCESS_KEY),
  };
}

export function formatBackupId(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) fail('BACKUP_TIME', 'Refusing to backup: invalid timestamp');
  const id = value.toISOString().replace(/[-:.]/g, '');
  if (!BACKUP_ID_RE.test(id)) fail('BACKUP_TIME', 'Refusing to backup: invalid timestamp');
  return id;
}

export function assertBackupId(backupId) {
  if (typeof backupId !== 'string' || !BACKUP_ID_RE.test(backupId)) {
    fail('RESTORE_BAD_ID', 'Refusing to restore: backup id is not a timestamped backup');
  }
  return backupId;
}

export function backupObjectKey(backupId, fileName) {
  assertBackupId(backupId);
  if (!LIVE_FILES.includes(fileName)) {
    fail('BACKUP_FILE', `Refusing to backup: ${fileName} is not a live data file`);
  }
  return `${BACKUP_KEY_PREFIX}/${backupId}/${fileName}`;
}

function liveFilePath(dataDir, fileName) {
  if (!dataDir) fail('BACKUP_DIR', 'Refusing to backup: dataDir is required');
  if (!LIVE_FILES.includes(fileName)) {
    fail('BACKUP_FILE', `Refusing to touch unexpected file ${fileName}`);
  }
  const root = path.resolve(dataDir);
  const file = path.resolve(root, fileName);
  if (path.relative(root, file) !== fileName) {
    fail('BACKUP_PATH', `Refusing to touch a path outside the data directory: ${fileName}`);
  }
  return { root, file };
}

function isEmpty(bytes) {
  return !bytes || bytes.length === 0 || bytes.toString('utf8').trim() === '';
}

function asBuffer(body) {
  if (body == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body);
  fail('BACKUP_BODY', 'Refusing to backup: file body is not bytes');
}

function readUpdatedAt(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'is not valid JSON' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'is not a saved trip object' };
  }
  if (typeof parsed.updatedAt !== 'string' || parsed.updatedAt.trim() === '') {
    return { ok: false, reason: 'has no updatedAt' };
  }
  const ms = Date.parse(parsed.updatedAt);
  if (!Number.isFinite(ms)) return { ok: false, reason: 'has an unreadable updatedAt' };
  return { ok: true, ms, updatedAt: parsed.updatedAt };
}

function assertUsersJson(bytes) {
  let parsed;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('RESTORE_INVALID', 'Refusing to restore: backup users.json is not valid JSON');
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.users : null;
  if (!Array.isArray(list)) {
    fail('RESTORE_INVALID', 'Refusing to restore: backup users.json has no users array');
  }
}

function readLiveBytes(dataDir, fileName, fsImpl) {
  const { file } = liveFilePath(dataDir, fileName);
  if (!fsImpl.existsSync(file)) fail('BACKUP_MISSING', `Refusing to backup: ${fileName} is missing`);
  const before = fsImpl.statSync(file);
  if (!before.isFile()) fail('BACKUP_NOT_FILE', `Refusing to backup: ${fileName} is not a file`);
  const first = asBuffer(fsImpl.readFileSync(file));
  const after = fsImpl.statSync(file);
  const second = asBuffer(fsImpl.readFileSync(file));
  if (
    before.ino !== after.ino ||
    before.mtimeMs !== after.mtimeMs ||
    before.size !== after.size ||
    before.nlink !== after.nlink ||
    !first.equals(second)
  ) {
    fail('BACKUP_SOURCE_CHANGED', `Refusing to backup: ${fileName} changed while it was read`);
  }
  if (isEmpty(second)) fail('BACKUP_EMPTY', `Refusing to backup: ${fileName} is empty`);
  return { file, bytes: second, before };
}

async function objectExists(client, bucket, key) {
  const body = await client.getObject({ bucket, key });
  return body != null;
}

export async function createBackup({ dataDir, now = new Date(), client, bucket, fsImpl = fs } = {}) {
  if (!client || typeof client.putObject !== 'function') {
    fail('BACKUP_CLIENT', 'Refusing to backup: a bucket client is required');
  }
  if (!bucket) fail('BACKUP_BUCKET', 'Refusing to backup: bucket name is required');
  const id = formatBackupId(now);
  const files = LIVE_FILES.map((name) => ({ name, ...readLiveBytes(dataDir, name, fsImpl) }));
  for (const file of files) {
    const key = backupObjectKey(id, file.name);
    if (await objectExists(client, bucket, key)) {
      fail('BACKUP_EXISTS', `Refusing to backup: ${id} already exists`);
    }
  }
  const uploaded = [];
  try {
    for (const file of files) {
      const key = backupObjectKey(id, file.name);
      await client.putObject({ bucket, key, body: Buffer.from(file.bytes) });
      uploaded.push(key);
      const after = fsImpl.statSync(file.file);
      if (after.ino !== file.before.ino || after.mtimeMs !== file.before.mtimeMs || after.size !== file.before.size) {
        fail('BACKUP_SOURCE_CHANGED', `Refusing to backup: ${file.name} changed while it was copied`);
      }
      if (!asBuffer(fsImpl.readFileSync(file.file)).equals(file.bytes)) {
        fail('BACKUP_SOURCE_CHANGED', `Refusing to backup: ${file.name} changed while it was copied`);
      }
    }
  } catch (err) {
    if (typeof client.deleteObject === 'function') {
      for (const key of uploaded) {
        try {
          await client.deleteObject({ bucket, key });
        } catch {
          /* leave the original error in place */
        }
      }
    }
    throw err;
  }
  return { backupId: id, bucket, files: [...LIVE_FILES] };
}

function assertNotOlder(backupBytes, currentPath, fsImpl) {
  const backupAt = readUpdatedAt(backupBytes);
  if (!backupAt.ok) fail('RESTORE_INVALID', `Refusing to restore: backup state.json ${backupAt.reason}`);
  if (!fsImpl.existsSync(currentPath)) return;
  const stat = fsImpl.statSync(currentPath);
  if (!stat.isFile()) fail('RESTORE_CURRENT', 'Refusing to restore: current state.json is not a file');
  if (stat.size === 0) return;
  let currentBytes;
  try {
    currentBytes = asBuffer(fsImpl.readFileSync(currentPath));
  } catch (err) {
    fail('RESTORE_CURRENT', `Refusing to restore: current state.json could not be read (${err.message})`);
  }
  if (isEmpty(currentBytes)) return;
  const currentAt = readUpdatedAt(currentBytes);
  if (!currentAt.ok) {
    fail('RESTORE_CURRENT', `Refusing to restore: current state.json ${currentAt.reason}, so a backup cannot be compared`);
  }
  if (backupAt.ms < currentAt.ms) {
    fail(
      'RESTORE_OLDER',
      `Refusing to restore: backup updatedAt ${backupAt.updatedAt} is older than current updatedAt ${currentAt.updatedAt}`,
    );
  }
}

async function readBackupObject(client, bucket, backupId, fileName) {
  const key = backupObjectKey(backupId, fileName);
  let body;
  try {
    body = await client.getObject({ bucket, key });
  } catch (err) {
    fail('RESTORE_READ', `Refusing to restore: backup ${fileName} could not be read (${err.message})`);
  }
  if (body == null) fail('RESTORE_MISSING', `Refusing to restore: backup ${fileName} is missing`);
  const bytes = asBuffer(body);
  if (isEmpty(bytes)) fail('RESTORE_EMPTY', `Refusing to restore: backup ${fileName} is empty`);
  return bytes;
}

function replaceLiveFiles(dataDir, payloads, fsImpl) {
  const previous = new Map();
  for (const name of LIVE_FILES) {
    const { file } = liveFilePath(dataDir, name);
    previous.set(name, fsImpl.existsSync(file) ? asBuffer(fsImpl.readFileSync(file)) : null);
  }
  const temps = [];
  const renamed = [];
  try {
    for (const name of LIVE_FILES) {
      const { root, file } = liveFilePath(dataDir, name);
      const prior = previous.get(name);
      const mode = prior ? fsImpl.statSync(file).mode & 0o777 : 0o600;
      const tmp = path.join(root, `.${name}.${process.pid}.restore-tmp`);
      if (path.relative(root, tmp) !== path.basename(tmp) || LIVE_FILES.includes(path.basename(tmp))) {
        fail('RESTORE_PATH', 'Refusing to restore: temporary file is not inside the data directory');
      }
      const fd = fsImpl.openSync(tmp, 'wx', mode);
      temps.push(tmp);
      try {
        fsImpl.writeFileSync(fd, payloads[name]);
      } finally {
        fsImpl.closeSync(fd);
      }
      fsImpl.chmodSync(tmp, mode);
      fsImpl.renameSync(tmp, file);
      renamed.push(name);
    }
  } catch (err) {
    for (const tmp of temps) {
      if (fsImpl.existsSync(tmp)) {
        try {
          fsImpl.rmSync(tmp, { force: true });
        } catch {
          /* ignore cleanup failure */
        }
      }
    }
    for (const name of renamed) {
      const { file } = liveFilePath(dataDir, name);
      const prior = previous.get(name);
      if (prior == null) {
        try {
          fsImpl.rmSync(file, { force: true });
        } catch {
          /* ignore cleanup failure */
        }
      } else {
        const mode = fsImpl.existsSync(file) ? fsImpl.statSync(file).mode & 0o777 : 0o600;
        fsImpl.writeFileSync(file, prior, { mode });
      }
    }
    throw err;
  }
}

export async function restoreBackup({ dataDir, backupId, client, bucket, fsImpl = fs } = {}) {
  if (!client || typeof client.getObject !== 'function') {
    fail('RESTORE_CLIENT', 'Refusing to restore: a bucket client is required');
  }
  if (!bucket) fail('RESTORE_BUCKET', 'Refusing to restore: bucket name is required');
  const id = assertBackupId(backupId);
  const payloads = {};
  for (const name of LIVE_FILES) {
    payloads[name] = await readBackupObject(client, bucket, id, name);
  }
  assertUsersJson(payloads['users.json']);
  assertNotOlder(payloads['state.json'], liveFilePath(dataDir, 'state.json').file, fsImpl);
  replaceLiveFiles(dataDir, payloads, fsImpl);
  return { backupId: id, files: [...LIVE_FILES] };
}

function parseBackupKey(key) {
  const parts = String(key ?? '').split('/');
  if (parts.length !== 3 || parts[0] !== BACKUP_KEY_PREFIX) return null;
  if (!BACKUP_ID_RE.test(parts[1]) || !LIVE_FILES.includes(parts[2])) return null;
  return { backupId: parts[1], name: parts[2] };
}

export async function listBackups({ client, bucket } = {}) {
  if (!client || typeof client.listObjects !== 'function') {
    fail('BACKUP_CLIENT', 'Refusing to list backups: a bucket client is required');
  }
  if (!bucket) fail('BACKUP_BUCKET', 'Refusing to list backups: bucket name is required');
  const listed = await client.listObjects({ bucket, prefix: `${BACKUP_KEY_PREFIX}/` });
  const namesById = new Map();
  for (const item of listed ?? []) {
    const parsed = parseBackupKey(item?.key);
    if (!parsed) continue;
    if (!namesById.has(parsed.backupId)) namesById.set(parsed.backupId, new Set());
    namesById.get(parsed.backupId).add(parsed.name);
  }
  const ids = [...namesById.entries()]
    .filter(([, names]) => LIVE_FILES.every((name) => names.has(name)))
    .map(([backupId]) => backupId)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const result = [];
  for (const backupId of ids) {
    const bytes = await client.getObject({ bucket, key: backupObjectKey(backupId, 'state.json') });
    const updated = bytes && !isEmpty(asBuffer(bytes)) ? readUpdatedAt(asBuffer(bytes)) : null;
    result.push({ backupId, updatedAt: updated?.ok ? updated.updatedAt : null });
  }
  return result;
}

function defaultSchedule(fn, intervalMs) {
  const timer = setInterval(fn, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  return () => clearInterval(timer);
}

export function startPeriodicBackup({
  dataDir,
  env = process.env,
  client,
  bucket,
  intervalMs = BACKUP_INTERVAL_MS,
  now = () => new Date(),
  fsImpl = fs,
  onError = (err) => console.warn('[backup]', err.message),
  runOnStart = true,
  schedule = defaultSchedule,
  createClient = createS3BackupClient,
} = {}) {
  let activeClient = client ?? null;
  let activeBucket = bucket ?? null;
  if (!activeClient) {
    const config = readBucketConfig(env);
    if (!config.ok) {
      return {
        started: false,
        intervalMs,
        missing: config.missing,
        reason: config.reason,
        stop() {},
        whenStarted: Promise.resolve(null),
      };
    }
    activeClient = createClient(config);
    activeBucket = config.bucket;
  }
  if (!activeBucket) fail('BACKUP_BUCKET', 'Refusing to backup: bucket name is required');
  let stopped = false;
  let running = false;
  async function run() {
    if (stopped || running) return null;
    running = true;
    try {
      return await createBackup({
        dataDir,
        now: now(),
        client: activeClient,
        bucket: activeBucket,
        fsImpl,
      });
    } finally {
      running = false;
    }
  }
  const cancel = schedule(() => run().catch((err) => onError(err)), intervalMs);
  const whenStarted = runOnStart ? run().catch((err) => { onError(err); return null; }) : Promise.resolve(null);
  return {
    started: true,
    intervalMs,
    missing: [],
    stop() {
      stopped = true;
      cancel();
    },
    whenStarted,
  };
}

function printLine(stream, line) {
  if (typeof stream === 'function') stream(line);
  else if (stream && typeof stream.write === 'function') stream.write(`${line}\n`);
}

export async function runCli(argv, deps = {}) {
  const stdout = deps.stdout ?? ((line) => console.log(line));
  const stderr = deps.stderr ?? ((line) => console.error(line));
  try {
    const args = argv.slice(2);
    const command = args[0];
    const env = deps.env ?? process.env;
    const fsImpl = deps.fsImpl ?? fs;
    const dataDir = deps.dataDir ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data');
    let client = deps.client ?? null;
    let bucket = deps.bucket ?? null;
    if (!client) {
      const config = readBucketConfig(env);
      if (!config.ok) {
        fail('BACKUP_CONFIG', `Refusing to use the bucket: ${config.reason}. Set ${BUCKET_ENV_VARS.join(', ')}.`);
      }
      const factory = deps.createClient ?? createS3BackupClient;
      client = factory(config);
      bucket = config.bucket;
    }
    if (!bucket) fail('BACKUP_BUCKET', 'Refusing to backup: bucket name is required');
    if (command === 'backup') {
      const result = await createBackup({ dataDir, client, bucket, fsImpl, now: deps.now });
      printLine(stdout, result.backupId);
      return 0;
    }
    if (command === 'list') {
      const rows = await listBackups({ client, bucket });
      for (const row of rows) printLine(stdout, row.updatedAt ? `${row.backupId} ${row.updatedAt}` : row.backupId);
      return 0;
    }
    if (command === 'restore') {
      const idIndex = args.indexOf('--id');
      const backupId = idIndex === -1 ? undefined : args[idIndex + 1];
      const result = await restoreBackup({ dataDir, backupId, client, bucket, fsImpl });
      printLine(stdout, result.backupId);
      return 0;
    }
    fail('BACKUP_USAGE', 'Usage: backup.js backup|list|restore --id <backup-id>');
  } catch (err) {
    printLine(stderr, err.message);
    return 1;
  }
  return 1;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isDirectRun()) {
  runCli(process.argv).then((code) => {
    process.exitCode = code;
  });
}
