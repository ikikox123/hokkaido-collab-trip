/**
 * JSON documents in the Durable Object's SQLite, split into chunks so a trip
 * with long route geometries stays under the per-row size limit.
 */

const CHUNK_CHARS = 256 * 1024;

function ensureTable(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS doc_chunks (
    name TEXT NOT NULL,
    idx INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (name, idx)
  )`);
}

export function loadDoc(sql, name) {
  ensureTable(sql);
  const rows = sql.exec('SELECT body FROM doc_chunks WHERE name = ? ORDER BY idx', name).toArray();
  if (!rows.length) return null;
  return JSON.parse(rows.map((row) => row.body).join(''));
}

export function saveDoc(sql, name, value) {
  ensureTable(sql);
  const text = JSON.stringify(value);
  sql.exec('DELETE FROM doc_chunks WHERE name = ?', name);
  for (let i = 0, idx = 0; i < text.length; i += CHUNK_CHARS, idx++) {
    sql.exec('INSERT INTO doc_chunks (name, idx, body) VALUES (?, ?, ?)', name, idx, text.slice(i, i + CHUNK_CHARS));
  }
}
