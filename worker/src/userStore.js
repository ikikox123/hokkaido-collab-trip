import bcrypt from 'bcryptjs';

/**
 * Accounts in the Durable Object's SQLite table. Same rules as server/src/users.js:
 * bcrypt hashes (existing users.json rows import unchanged), stable `u_` ids that
 * double as split-member ids, and dev-only alice/bob that live in memory only.
 */

export const DEMO_USERS = [
  { id: 'u1', username: 'alice', displayName: 'Alice' },
  { id: 'u2', username: 'bob', displayName: 'Bob' },
];

const DEMO_IDS = new Set(DEMO_USERS.map((user) => user.id));
const DEMO_NAMES = new Set(DEMO_USERS.map((user) => user.username));
const USERNAME_MAX = 32;
const PASSWORD_MAX_BYTES = 72;
const ROUNDS = 10;

export function normalizeUsername(username) {
  return String(username ?? '').trim().toLowerCase();
}

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
  if (new TextEncoder().encode(pass).length > PASSWORD_MAX_BYTES) return '密碼請勿超過 72 個字元';
  return null;
}

function publicUser(user) {
  return { id: user.id, username: user.username, displayName: user.displayName };
}

function isRegisteredAccountId(id) {
  return typeof id === 'string' && /^u_[0-9a-f]{16}$/.test(id);
}

/** alice/bob rows that registration did not mint. Production drops them unless they are companions. */
export function isRemovableDemoRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (row.username !== 'alice' && row.username !== 'bob') return false;
  return typeof row.id === 'string' && Boolean(row.id) && !isRegisteredAccountId(row.id);
}

/** Validate one users.json row. Returns a clean record or null. */
export function rowToUser(row) {
  if (!row || typeof row !== 'object') return null;
  const username = normalizeUsername(typeof row.username === 'string' ? row.username : '');
  const passwordHash = typeof row.passwordHash === 'string' ? row.passwordHash : '';
  const id = typeof row.id === 'string' ? row.id : '';
  const displayNameRaw = typeof row.displayName === 'string' ? row.displayName.trim() : '';
  if (!username || !passwordHash || !id) return null;
  if (passwordHash.length > 200 || id.length > 80) return null;
  return { id, username, displayName: (displayNameRaw || username).slice(0, USERNAME_MAX), passwordHash };
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `u_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

async function passwordMatches(password, passwordHash) {
  if (!passwordHash || typeof password !== 'string') return false;
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

export function createUserStore(sql, { production }) {
  sql.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL
  )`);

  let users = [];
  const pending = new Set();

  function loadSaved() {
    return sql
      .exec('SELECT id, username, display_name, password_hash FROM users ORDER BY rowid')
      .toArray()
      .map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        passwordHash: row.password_hash,
        demo: false,
      }));
  }

  async function init() {
    const saved = loadSaved();
    if (production) {
      users = saved;
      return;
    }
    const hash = await bcrypt.hash('demo1234', ROUNDS);
    const demos = DEMO_USERS.map((user) => ({ ...user, passwordHash: hash, demo: true }));
    users = [...demos, ...saved.filter((user) => !DEMO_NAMES.has(user.username) && !DEMO_IDS.has(user.id))];
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
    if (!user || !(await passwordMatches(String(password), user.passwordHash))) {
      return { ok: false, status: 401, error: '帳號或密碼錯誤' };
    }
    return { ok: true, user: publicUser(user) };
  }

  async function register({ username, password } = {}) {
    const error = credentialError(username, password);
    if (error) return { ok: false, status: 400, error };
    const name = normalizeUsername(username);
    if (production && DEMO_NAMES.has(name)) {
      return { ok: false, status: 400, error: '這個帳號名稱不能使用' };
    }
    if (findByUsername(name) || pending.has(name)) {
      return { ok: false, status: 409, error: '這個帳號已經有人使用' };
    }
    pending.add(name);
    try {
      const displayName = String(username).trim().slice(0, USERNAME_MAX);
      const passwordHash = await bcrypt.hash(String(password), ROUNDS);
      if (findByUsername(name)) return { ok: false, status: 409, error: '這個帳號已經有人使用' };
      const record = { id: randomId(), username: name, displayName, passwordHash, demo: false };
      sql.exec(
        'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
        record.id,
        record.username,
        record.displayName,
        record.passwordHash,
      );
      users.push(record);
      return { ok: true, status: 201, user: publicUser(record) };
    } catch (err) {
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

  function isDemoAccount(id) {
    const user = users.find((item) => item.id === id);
    return Boolean(user && user.demo);
  }

  /**
   * Replace every saved account with users.json rows.
   * Demo alice/bob rows are dropped unless the trip lists them as companions.
   */
  async function replaceAll(rows, companionIds) {
    const companions = new Set(companionIds);
    const seen = new Set();
    const clean = [];
    for (const row of rows) {
      if (isRemovableDemoRow(row) && !companions.has(row.id)) continue;
      const user = rowToUser(row);
      if (!user || seen.has(user.username)) continue;
      seen.add(user.username);
      clean.push(user);
    }
    sql.exec('DELETE FROM users');
    for (const user of clean) {
      sql.exec(
        'INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)',
        user.id,
        user.username,
        user.displayName,
        user.passwordHash,
      );
    }
    await init();
    return clean.length;
  }

  function exportAll() {
    return loadSaved().map(({ id, username, displayName, passwordHash }) => ({ id, username, displayName, passwordHash }));
  }

  return { init, authenticate, register, findByUsername, publicById, isDemoAccount, replaceAll, exportAll };
}
