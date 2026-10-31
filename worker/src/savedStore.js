/**
 * Saved places and Shortcut keys in the Durable Object's SQLite. New tables only; trip state is never touched.
 * saved_keys keeps SHA-256 of the key secret (never the key). One key per user: making a new one replaces the old.
 * saved_places rows are 'personal' (readable by user_id alone) or 'shared' (the trip's list; user_id = who shared it).
 */
import { generateSavedKey } from '../../server/src/savedKey.js';
import { cleanDistrict, googleMapsSearchUrl, normalizeCityName } from '../../server/src/savedPlace.js';

export const MAX_PLACES_PER_LIST = 300;

const SEED_FLAG = 'saved_seed';

function randomId() {
  return `sp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

/** Columns copied from a person's own place to its copy in the trip's shared list. */
export const SHARED_COPY_COLUMNS = ['name', 'type', 'country', 'city', 'district', 'address', 'lat', 'lng', 'precision', 'status', 'confidence'];

export function presentPlace(row, { ownerName = null, viewerId = null, sharedToTrip = false, alsoSavedBy = [] } = {}) {
  // Older rows may hold 札幌 / a street address as district: show them the way new rows are stored.
  const city = normalizeCityName(row.city);
  const district = cleanDistrict(row.district, city);
  const place = {
    id: row.id,
    scope: row.scope,
    name: row.name,
    type: row.type || null,
    country: row.country,
    city,
    district,
    address: row.address,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    precision: row.precision || (row.lat != null ? 'place' : null),
    status: row.status,
    confidence: row.confidence,
    sourceUrl: row.source_url || null,
    mapsUrl: googleMapsSearchUrl({ name: row.name, city, district, address: row.address }),
    hasText: Boolean(row.source_text),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.scope === 'personal') place.sharedToTrip = sharedToTrip;
  if (row.scope === 'shared') {
    place.addedBy = ownerName;
    place.alsoSavedBy = alsoSavedBy;
    place.mine = viewerId != null && row.user_id === viewerId;
  }
  return place;
}

export function parseAlsoBy(value) {
  try {
    const list = JSON.parse(value || '[]');
    return Array.isArray(list) ? list.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function createSavedStore(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS saved_keys (
    key_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE,
    secret_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  sql.exec(`CREATE TABLE IF NOT EXISTS saved_places (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    country TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    district TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    lat REAL,
    lng REAL,
    source_url TEXT NOT NULL DEFAULT '',
    source_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    confidence REAL NOT NULL DEFAULT 0,
    shared_from TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
  try {
    sql.exec('ALTER TABLE saved_places ADD COLUMN precision TEXT'); // older rows keep NULL
  } catch {
    // column already there
  }
  try {
    sql.exec("ALTER TABLE saved_places ADD COLUMN also_by TEXT NOT NULL DEFAULT '[]'"); // user ids who also saved a shared place
  } catch {
    // column already there
  }
  sql.exec('CREATE INDEX IF NOT EXISTS saved_places_owner ON saved_places (scope, user_id)');

  const all = (query, ...args) => sql.exec(query, ...args).toArray();
  const one = (query, ...args) => all(query, ...args)[0] ?? null;

  return {
    // ----- keys -----
    /** Replaces any earlier key. Returns the plaintext key once; only its hash is stored. */
    async createKey(userId) {
      const { key, keyId, hash } = await generateSavedKey();
      const createdAt = new Date().toISOString();
      // user_id is UNIQUE, so the new row is an upsert: one statement either swaps in the new key or throws
      // with the old one untouched. Only then are any other rows of this user removed.
      sql.exec(
        `INSERT INTO saved_keys (key_id, user_id, secret_hash, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET key_id = excluded.key_id, secret_hash = excluded.secret_hash, created_at = excluded.created_at`,
        keyId, userId, hash, createdAt,
      );
      sql.exec('DELETE FROM saved_keys WHERE user_id = ? AND key_id != ?', userId, keyId);
      return { key, createdAt };
    },
    keyInfo(userId) {
      const row = one('SELECT created_at FROM saved_keys WHERE user_id = ?', userId);
      return { hasKey: Boolean(row), createdAt: row?.created_at ?? null };
    },
    revokeKey(userId) {
      sql.exec('DELETE FROM saved_keys WHERE user_id = ?', userId);
    },
    findKey(keyId) {
      return one('SELECT key_id, user_id, secret_hash FROM saved_keys WHERE key_id = ?', keyId);
    },

    // ----- places -----
    list(scope, userId) {
      return scope === 'shared'
        ? all("SELECT * FROM saved_places WHERE scope = 'shared' ORDER BY updated_at DESC, rowid DESC")
        : all("SELECT * FROM saved_places WHERE scope = 'personal' AND user_id = ? ORDER BY updated_at DESC, rowid DESC", userId);
    },
    count(scope, userId) {
      const row =
        scope === 'shared'
          ? one("SELECT COUNT(*) AS n FROM saved_places WHERE scope = 'shared'")
          : one("SELECT COUNT(*) AS n FROM saved_places WHERE scope = 'personal' AND user_id = ?", userId);
      return row?.n ?? 0;
    },
    get(id) {
      return one('SELECT * FROM saved_places WHERE id = ?', String(id));
    },
    findBySource(userId, sourceUrl) {
      if (!sourceUrl) return null;
      return one("SELECT * FROM saved_places WHERE scope = 'personal' AND user_id = ? AND source_url = ?", userId, sourceUrl);
    },
    findSharedCopy(personalId) {
      return one("SELECT * FROM saved_places WHERE scope = 'shared' AND shared_from = ?", personalId);
    },
    insert(row) {
      const now = new Date().toISOString();
      const full = {
        id: randomId(),
        type: null,
        country: '',
        city: '',
        district: '',
        address: '',
        lat: null,
        lng: null,
        precision: null,
        source_url: '',
        source_text: '',
        confidence: 0,
        shared_from: null,
        created_at: now,
        updated_at: now,
        ...row,
      };
      sql.exec(
        `INSERT INTO saved_places (id, scope, user_id, name, type, country, city, district, address, lat, lng,
           precision, source_url, source_text, status, confidence, shared_from, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        full.id, full.scope, full.user_id, full.name, full.type, full.country, full.city, full.district, full.address,
        full.lat, full.lng, full.precision, full.source_url, full.source_text, full.status, full.confidence, full.shared_from,
        full.created_at, full.updated_at,
      );
      return this.get(full.id);
    },
    update(id, set) {
      const columns = Object.keys(set);
      if (!columns.length) return this.get(id);
      const allowed = new Set(['name', 'type', 'country', 'city', 'district', 'address', 'lat', 'lng', 'precision', 'source_url', 'source_text', 'status', 'confidence', 'also_by']);
      const safe = columns.filter((c) => allowed.has(c));
      sql.exec(
        `UPDATE saved_places SET ${safe.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...safe.map((c) => set[c]),
        new Date().toISOString(),
        id,
      );
      return this.get(id);
    },
    /** Add a user to "also saved by" of a shared place. Never the sharer, never twice. */
    addAlsoSavedBy(id, userId) {
      const row = this.get(id);
      if (!row || row.user_id === userId) return row;
      const ids = parseAlsoBy(row.also_by);
      if (ids.includes(userId)) return row;
      return this.update(id, { also_by: JSON.stringify([...ids, userId]) });
    },
    remove(id) {
      sql.exec('DELETE FROM saved_places WHERE id = ?', id);
    },

    /** Non-production demo rows for alice (u1), once. Names say they are examples. */
    seedDemo(loadFlag, saveFlag) {
      if (loadFlag(SEED_FLAG)) return;
      saveFlag(SEED_FLAG, { at: new Date().toISOString() });
      const demo = [
        { name: '範例｜札幌湯咖哩 Garaku 風', type: 'eat', city: '札幌市', district: '中央区', address: '', lat: 43.0553, lng: 141.3412, status: 'ready', confidence: 0.9, source_url: 'https://www.threads.net/@example/post/sample1' },
        { name: '範例｜小樽運河', type: 'sight', city: '小樽市', district: '', address: '', lat: 43.1976, lng: 141.0044, status: 'ready', confidence: 0.85, source_url: 'https://www.instagram.com/p/sample2' },
        { name: '範例｜薄野的深夜拉麵（名稱待確認）', type: 'eat', city: '札幌市', district: '中央区', status: 'pending', confidence: 0.3, source_url: 'https://www.threads.net/@example/post/sample3' },
        { name: '範例｜登別溫泉旅館', type: 'stay', city: '登別市', district: '', lat: 42.4963, lng: 141.1459, status: 'ready', confidence: 0.8 },
      ];
      const inserted = demo.map((row, i) =>
        this.insert({
          scope: 'personal',
          user_id: 'u1',
          country: '日本',
          ...row,
          created_at: new Date(Date.now() - i * 60_000).toISOString(),
          updated_at: new Date(Date.now() - i * 60_000).toISOString(),
        }),
      );
      const first = inserted[1];
      const { id: sourceId, ...rest } = first;
      this.insert({ ...rest, scope: 'shared', shared_from: sourceId });
    },
  };
}
