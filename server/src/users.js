import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * Dev-only demo accounts. Production does not recreate them.
 * In development they are always recreated in memory and registration cannot replace them.
 * They are never written to users.json by this store.
 */

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

/** Ids minted by register(). A later alice/bob with this id is a normal account, not a demo row. */
function isRegisteredAccountId(id) {
  return typeof id === 'string' && /^u_[0-9a-f]{16}$/.test(id);
}

function isExactDemoUsername(username) {
  return username === 'alice' || username === 'bob';
}

/**
 * A users.json row is a demo account when the username is exactly alice or bob
 * and the id was not minted by registration. Companion membership is checked separately.
 */
function isRemovableDemoRow(row) {
  if (!row || typeof row !== 'object') return false;
  if (!isExactDemoUsername(row.username)) return false;
  if (typeof row.id !== 'string' || !row.id || isRegisteredAccountId(row.id)) return false;
  return true;
}

function readUsersDocument(dataFile) {
  assertAccountFile(dataFile);
  if (!dataFile || !fs.existsSync(dataFile)) return { status: 'missing', list: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (err) {
    console.warn('[users] 無法讀取帳號檔，只保留示範帳號', err?.message || err);
    return { status: 'invalid', list: [] };
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.users;
  if (!Array.isArray(list)) return { status: 'invalid', list: [] };
  return { status: 'ok', list };
}

function rowToUser(row, { skipDemos }) {
  if (!row || typeof row !== 'object') return null;
  const rawUsername = typeof row.username === 'string' ? row.username : '';
  const username = normalizeUsername(rawUsername);
  const passwordHash = typeof row.passwordHash === 'string' ? row.passwordHash : '';
  const id = typeof row.id === 'string' ? row.id : '';
  const displayNameRaw = typeof row.displayName === 'string' ? row.displayName.trim() : '';
  if (!username || !passwordHash || !id) return null;
  if (passwordHash.length > 200 || id.length > 80) return null;
  if (skipDemos && (DEMO_NAMES.has(username) || DEMO_IDS.has(id))) return null;
  return {
    id,
    username,
    displayName: (displayNameRaw || username).slice(0, USERNAME_MAX),
    passwordHash,
    demo: false,
    removableDemo: isRemovableDemoRow(row),
  };
}

function usersFromList(list, { skipDemos }) {
  const seen = new Set();
  const out = [];
  for (const row of list) {
    const user = rowToUser(row, { skipDemos });
    if (!user || seen.has(user.username)) continue;
    seen.add(user.username);
    out.push(user);
  }
  return out;
}

function readSavedUsers(dataFile, { skipDemos }) {
  const doc = readUsersDocument(dataFile);
  if (doc.status !== 'ok') return [];
  return usersFromList(doc.list, { skipDemos });
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
 * Demo users are never written to disk. Development recreates alice (u1) and bob (u2)
 * in memory. Production does not create them, drops leftover demo rows that are
 * not on the companion list, and rejects new registration of those names.
 * This store does not load, migrate, or replace trip state.
 *
 * The account id is the split-member id. It is chosen once at registration and
 * reloaded from users.json. Startup does not mint a new id.
 */
export function createUserStore({ dataFile, demoPassword = 'demo1234', rounds = 10, nodeEnv = process.env.NODE_ENV } = {}) {
  let users = [];
  const pending = new Set();
  const production = nodeEnv === 'production';
  let writeQueue = Promise.resolve();

  function enqueueWrite(task) {
    const run = writeQueue.then(task, task);
    writeQueue = run.then(() => {}, () => {});
    return run;
  }

  async function init() {
    assertAccountFile(dataFile);
    if (production) {
      users = readSavedUsers(dataFile, { skipDemos: false });
      return;
    }
    const hash = await bcrypt.hash(demoPassword, rounds);
    const demos = DEMO_USERS.map((user) => ({
      ...user,
      passwordHash: hash,
      demo: true,
    }));
    users = [...demos, ...readSavedUsers(dataFile, { skipDemos: true })];
  }

  /**
   * Production only. Drops demo alice/bob from memory immediately when they are
   * not companion ids. The users.json rewrite is commit(), which the server runs
   * after the startup backup. Dev is a no-op. Missing or unreadable files are not written.
   */
  function planProductionDemoRemoval(memberIds) {
    if (!production) return { commit: async () => {} };
    const companions = new Set(
      (Array.isArray(memberIds) ? memberIds : [])
        .filter((id) => typeof id === 'string')
        .map((id) => id.trim())
        .filter(Boolean),
    );
    const doc = readUsersDocument(dataFile);
    const removeIds = new Set();
    if (doc.status === 'ok') {
      for (const row of doc.list) {
        if (!isRemovableDemoRow(row)) continue;
        if (companions.has(row.id.trim())) {
          console.warn(`[users] ${row.username} is on the companion list; not removed`);
          continue;
        }
        removeIds.add(row.id);
      }
    }
    if (removeIds.size > 0) {
      users = users.filter((user) => !removeIds.has(user.id));
    }
    return {
      async commit() {
        if (removeIds.size === 0 || !dataFile) return;
        try {
          await enqueueWrite(() => {
            const current = readUsersDocument(dataFile);
            if (current.status !== 'ok') return;
            const doomed = current.list.filter((row) => row && removeIds.has(row.id));
            if (doomed.length === 0) return;
            const doomedIds = new Set(doomed.map((row) => row.id));
            const keep = [];
            for (const row of current.list) {
              if (!row || typeof row !== 'object' || doomedIds.has(row.id)) continue;
              if (typeof row.id !== 'string' || typeof row.username !== 'string' || typeof row.passwordHash !== 'string') {
                continue;
              }
              if (!row.id || !row.username || !row.passwordHash) continue;
              keep.push({
                id: row.id,
                username: row.username,
                displayName: typeof row.displayName === 'string' ? row.displayName : row.username,
                passwordHash: row.passwordHash,
                demo: false,
              });
            }
            writeSavedUsers(dataFile, keep);
            const names = doomed.map((row) => row.username);
            console.log(`[users] removed ${names.length}: ${names.join(', ')}`);
          });
        } catch (err) {
          console.warn('[users] 無法寫入帳號檔', err?.message || err);
        }
      },
    };
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
    if (production && (name === 'alice' || name === 'bob')) {
      return { ok: false, status: 400, error: '這個帳號名稱不能使用' };
    }
    if (findByUsername(name) || pending.has(name)) {
      return { ok: false, status: 409, error: '這個帳號已經有人使用' };
    }
    pending.add(name);
    try {
      const displayName = String(username).trim().slice(0, USERNAME_MAX);
      const id = `u_${crypto.randomBytes(8).toString('hex')}`;
      const passwordHash = await bcrypt.hash(String(password), rounds);
      const record = { id, username: name, displayName, passwordHash, demo: false, removableDemo: false };
      users.push(record);
      if (dataFile) await enqueueWrite(() => writeSavedUsers(dataFile, users));
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

  /** Dev alice/bob live only in memory. Accounts written by register() are not demos. */
  function isDemoAccount(id) {
    if (typeof id !== 'string' || !id) return false;
    const user = users.find((item) => item.id === id);
    return Boolean(user && user.demo);
  }

  return { init, authenticate, register, findByUsername, publicById, isDemoAccount, planProductionDemoRemoval };
}
