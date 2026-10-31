/**
 * Saved places and Shortcut keys in the Durable Object's SQLite. New tables only; trip state is never touched.
 * saved_keys keeps SHA-256 of the key secret (never the key). One key per user: making a new one replaces the old.
 * saved_places rows are 'personal' (readable by user_id alone) or 'shared' (the trip's list; user_id = who shared it).
 */
import { generateSavedKey } from '../../server/src/savedKey.js';
import { googleMapsSearchUrl } from '../../server/src/savedPlace.js';

export const MAX_PLACES_PER_LIST = 300;

const SEED_FLAG = 'saved_seed';

function randomId() {
  return `sp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function presentPlace(row, { ownerName = null, viewerId = null } = {}) {
  const place = {
    id: row.id,
    scope: row.scope,
    name: row.name,
    type: row.type || null,
    country: row.country,
    city: row.city,
    district: row.district,
    address: row.address,
    lat: row.lat ?? null,
    lng: row.lng ?? null,
    precision: row.precision || (row.lat != null ? 'place' : null),
    status: row.status,
    confidence: row.confidence,
    sourceUrl: row.source_url || null,
    mapsUrl: googleMapsSearchUrl({ name: row.name, city: row.city, district: row.district, address: row.address }),
    hasText: Boolean(row.source_text),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.scope === 'shared') {
    place.addedBy = ownerName;
    place.mine = viewerId != null && row.user_id === viewerId;
  }
  return place;
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
  sql.exec('CREATE INDEX IF NOT EXISTS saved_places_owner ON saved_places (scope, user_id)');

  const all = (query, ...args) => sql.exec(query, ...args).toArray();
  const one = (query, ...args) => all(query, ...args)[0] ?? null;

  return {
    // ----- keys -----
    /** Replaces any earlier key. Returns the plaintext key once; only its hash is stored. */
    async createKey(userId) {
      const { key, keyId, hash } = await generateSavedKey();
      const createdAt = new Date().toISOString();
      sql.exec('DELETE FROM saved_keys WHERE user_id = ?', userId);
      sql.exec('INSERT INTO saved_keys (key_id, user_id, secret_hash, created_at) VALUES (?, ?, ?, ?)', keyId, userId, hash, createdAt);
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
      const allowed = new Set(['name', 'type', 'country', 'city', 'district', 'address', 'lat', 'lng', 'precision', 'source_url', 'source_text', 'status', 'confidence']);
      const safe = columns.filter((c) => allowed.has(c));
      sql.exec(
        `UPDATE saved_places SET ${safe.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
        ...safe.map((c) => set[c]),
        new Date().toISOString(),
        id,
      );
      return this.get(id);
    },
    remove(id) {
      sql.exec('DELETE FROM saved_places WHERE id = ?', id);
    },

    /** Non-production demo rows for alice (u1), once. Names say they are examples. */
    seedDemo(loadFlag, saveFlag) {
      if (loadFlag(SEED_FLAG)) return;
      saveFlag(SEED_FLAG, { at: new Date().toISOString() });
      const demo = [
        { name: '範例｜札幌湯咖哩 Garaku 風', type: 'eat', city: '札幌', district: '中央区', address: '', lat: 43.0553, lng: 141.3412, status: 'ready', confidence: 0.9, source_url: 'https://www.threads.net/@example/post/sample1' },
        { name: '範例｜小樽運河', type: 'sight', city: '小樽', district: '色內', address: '', lat: 43.1976, lng: 141.0044, status: 'ready', confidence: 0.85, source_url: 'https://www.instagram.com/p/sample2' },
        { name: '範例｜薄野的深夜拉麵（名稱待確認）', type: 'eat', city: '札幌', district: '中央区', status: 'pending', confidence: 0.3, source_url: 'https://www.threads.net/@example/post/sample3' },
        { name: '範例｜登別溫泉旅館', type: 'stay', city: '登別', district: '', lat: 42.4963, lng: 141.1459, status: 'ready', confidence: 0.8 },
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
