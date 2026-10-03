import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/** Reserved demo accounts. Always recreated at startup; registration cannot replace them. */
export const DEMO_USERS = [
  { id: 'u1', username: 'alice', displayName: 'Alice' },
  { id: 'u2', username: 'bob', displayName: 'Bob' },
];

const DEMO_IDS = new Set(DEMO_USERS.map((user) => user.id));
const DEMO_NAMES = new Set(DEMO_USERS.map((user) => user.username));
const USERNAME_MAX = 32;
const PASSWORD_MAX_BYTES = 72;
/** Runtime trip files. Account storage must never read or replace these. */
const TRIP_STATE_FILES = new Set(['state.json', 'geocode-cache.json']);

function assertAccountFile(dataFile) {
  if (!dataFile) return;
  const base = path.basename(dataFile);
  if (TRIP_STATE_FILES.has(base)) {
    throw new Error('帳號檔不可使用行程狀態檔');
  }
}

export function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

/**
 * Shared empty / shape checks for login and registration.
 * Returns a Traditional Chinese message, or null when the pair can be checked further.
 */
export function credentialError(username, password) {
  const name = String(username ?? '').trim();
  const pass = String(password ?? '');
  const passBlank = pass.trim() === '';
  if (!name && passBlank) return '請輸入帳號與密碼';
  if (!name) return '請輸入帳號';
  if (passBlank) return '請輸入密碼';
  if (/[\u0000-\u001F\u007F]/.test(name)) return '帳號含有無法使用的字元';
  if (/\s/.test(name)) return '帳號不能包含空白';
  if ([...name].length > USERNAME_MAX) return '帳號請勿超過 32 個字';
  if (Buffer.byteLength(pass, 'utf8') > PASSWORD_MAX_BYTES) return '密碼請勿超過 72 個字元';
  return null;
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function readSavedUsers(dataFile) {
  assertAccountFile(dataFile);
  try {
    if (!dataFile || !fs.existsSync(dataFile)) return [];
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    const list = Array.isArray(parsed) ? parsed : parsed?.users;
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const row of list) {
      if (!row || typeof row !== 'object') continue;
      const username = normalizeUsername(row.username);
      const passwordHash = typeof row.passwordHash === 'string' ? row.passwordHash : '';
      const id = typeof row.id === 'string' ? row.id : '';
      const displayNameRaw = typeof row.displayName === 'string' ? row.displayName.trim() : '';
      if (!username || !passwordHash || !id) continue;
      if (DEMO_NAMES.has(username) || DEMO_IDS.has(id) || seen.has(username)) continue;
      if (passwordHash.length > 200 || id.length > 80) continue;
      seen.add(username);
      out.push({
        id,
        username,
        displayName: (displayNameRaw || username).slice(0, USERNAME_MAX),
        passwordHash,
        demo: false,
      });
    }
    return out;
  } catch (err) {
    console.warn('[users] 無法讀取帳號檔，只保留示範帳號', err?.message || err);
    return [];
  }
}

function writeSavedUsers(dataFile, users) {
  assertAccountFile(dataFile);
  const records = users
    .filter((user) => !user.demo)
    .map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      passwordHash: user.passwordHash,
    }));
  const dir = path.dirname(dataFile);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${dataFile}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify({ users: records }, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(tmp, dataFile);
}

async function passwordMatches(password, passwordHash) {
  if (!passwordHash || typeof password !== 'string') return false;
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

/**
 * In-memory accounts plus a gitignored JSON file of bcrypt hashes.
 * Demo users are never written to disk.
 * This store does not load, migrate, or replace trip state.
 *
 * The account id is the split-member id. It is chosen once at registration and
 * reloaded from users.json. Startup does not mint a new id. alice and bob stay u1 and u2.
 */
export function createUserStore({ dataFile, demoPassword = 'demo1234', rounds = 10 } = {}) {
  let users = [];
  const pending = new Set();

  async function init() {
    assertAccountFile(dataFile);
    const hash = await bcrypt.hash(demoPassword, rounds);
    const demos = DEMO_USERS.map((user) => ({
      ...user,
      passwordHash: hash,
      demo: true,
    }));
    users = [...demos, ...readSavedUsers(dataFile)];
  }

  function findByUsername(username) {
    const name = normalizeUsername(username);
    if (!name) return null;
    return users.find((user) => user.username === name) || null;
  }

  async function authenticate(username, password) {
    const error = credentialError(username, password);
    if (error) return { ok: false, status: 400, error };
    const user = findByUsername(username);
    const pass = String(password);
    if (!user || !(await passwordMatches(pass, user.passwordHash))) {
      return { ok: false, status: 401, error: '帳號或密碼錯誤' };
    }
    return { ok: true, user: publicUser(user) };
  }

  async function register({ username, password } = {}) {
    assertAccountFile(dataFile);
    const error = credentialError(username, password);
    if (error) return { ok: false, status: 400, error };
    const name = normalizeUsername(username);
    if (findByUsername(name) || pending.has(name)) {
      return { ok: false, status: 409, error: '這個帳號已經有人使用' };
    }
    pending.add(name);
    try {
      const displayName = String(username).trim().slice(0, USERNAME_MAX);
      const id = `u_${crypto.randomBytes(8).toString('hex')}`;
      const passwordHash = await bcrypt.hash(String(password), rounds);
      const record = { id, username: name, displayName, passwordHash, demo: false };
      users.push(record);
      if (dataFile) writeSavedUsers(dataFile, users);
      return { ok: true, status: 201, user: publicUser(record) };
    } catch (err) {
      users = users.filter((user) => user.demo || user.username !== name);
      console.warn('[users] 註冊寫入失敗', err?.message || err);
      return { ok: false, status: 500, error: '註冊沒有成功，請稍後再試' };
    } finally {
      pending.delete(name);
    }
  }

  function publicById(id) {
    if (typeof id !== 'string' || !id) return null;
    const user = users.find((item) => item.id === id);
    return user ? publicUser(user) : null;
  }

  return { init, authenticate, register, findByUsername, publicById };
}
