/**
 * HTTP routes for saved places, called from TripHub.route.
 *
 *   POST   /api/saved/ingest            Shortcut key (hks_...) only. {url, text} -> short result message.
 *   GET    /api/saved/key               login: has a key? when made?
 *   POST   /api/saved/key               login: make a key (replaces the old one); the key is in this response only.
 *   DELETE /api/saved/key               login: revoke
 *   GET    /api/saved?scope=mine|shared login (shared: trip companions only)
 *   PATCH  /api/saved/:id               login: edit fields and confirm (owner; shared: companions)
 *   DELETE /api/saved/:id               login: owner (shared: companions)
 *   POST   /api/saved/:id/reextract     login, owner: {text?} run extraction again
 *   POST   /api/saved/:id/share         login, owner + companion: copy into the shared list (a re-run or edit of the original updates the copy)
 *
 * A Shortcut key is accepted by ingest and by nothing else; a login token is not accepted by ingest.
 */
import { bearerToken, parseSavedKey, savedKeyMatches } from '../../server/src/savedKey.js';
import { cleanPlacePatch, parseIngestBody, readLimitedText, resolveDistrict, resultMessage, MAX_BODY_BYTES } from '../../server/src/savedPlace.js';
import { runIngest } from '../../server/src/savedIngest.js';
import { isTripMember } from '../../server/src/split.js';
import { createSavedRateLimiter } from '../../server/src/savedRateLimit.js';
import { findDuplicate, sourceKey } from '../../server/src/savedDedupe.js';
import { MAX_PLACES_PER_LIST, SHARED_COPY_COLUMNS, parseAlsoBy, presentPlace } from './savedStore.js';

const NOT_MEMBER = '只有這趟行程的旅伴可以這樣做';
const TOO_MANY = '請求太頻繁，請稍後再試';
const FULL = '收藏已達上限，請先刪除一些';

function json(body, status = 200, headers) {
  return Response.json(body, { status, headers });
}

export function createSavedLimiters() {
  return {
    key: createSavedRateLimiter(), // 10 / minute, 200 / day per Shortcut key
    user: createSavedRateLimiter(), // same budget for re-runs by a logged-in user
    ip: createSavedRateLimiter({ perMinute: 30, perDay: 1000 }), // before the key is even looked up
  };
}

function tooMany(result) {
  return json({ error: TOO_MANY }, 429, { 'Retry-After': String(result.retryAfterSec ?? 60) });
}

const ALREADY_SAVED = '已經收藏過了';
const ALREADY_SHARED = '已經有人分享過';
const SHARER_ONLY = '只有分享的人可以修改或刪除';

function isMember(hub, userId) {
  return Boolean(hub.tripState && isTripMember(hub.tripState, userId));
}

/** `sharedRows`: the trip's shared list, loaded once by callers that present many rows. */
function present(hub, row, viewerId = null, sharedRows = null) {
  const shared = row.scope === 'shared';
  return presentPlace(row, {
    ownerName: shared ? hub.users.publicById(row.user_id)?.displayName ?? null : null,
    viewerId,
    sharedToTrip: !shared && (sharedRows ?? hub.saved.list('shared')).some((r) => r.shared_from === row.id || findDuplicate(row, [r])),
    alsoSavedBy: shared ? parseAlsoBy(row.also_by).map((id) => hub.users.publicById(id)?.displayName).filter(Boolean) : [],
  });
}

/** After a person re-runs or edits their own place, the copy they shared to the trip follows. */
function syncSharedCopy(hub, row) {
  if (row.scope !== 'personal') return;
  const copy = hub.saved.findSharedCopy(row.id);
  if (!copy) return;
  hub.saved.update(copy.id, Object.fromEntries(SHARED_COPY_COLUMNS.map((column) => [column, row[column]])));
}

/** Run extraction and geocoding for a place; returns the column values to store. */
async function extractColumns(hub, { url, text }) {
  const result = await runIngest({
    url,
    text,
    ai: hub.env.AI,
    model: hub.env.SAVED_AI_MODEL,
    fetchImpl: hub.savedFetch,
    geocode: hub.placeGeocoder,
  });
  const { fields, geo } = result;
  return {
    result,
    columns: {
      name: fields.name || '（未命名）',
      type: fields.type,
      country: fields.country,
      city: fields.city,
      district: fields.district,
      address: geo?.address ?? '',
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      precision: geo?.precision ?? null,
      status: result.status,
      confidence: fields.confidence,
    },
  };
}

function duplicateReply(hub, row) {
  const place = present(hub, row);
  return json({ ok: true, duplicate: true, created: false, id: row.id, status: place.status, message: ALREADY_SAVED, place });
}

async function ingest(hub, request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ipCheck = hub.savedLimits.ip.attempt(`ip:${ip}`);
  if (!ipCheck.ok) return tooMany(ipCheck);

  const presented = parseSavedKey(bearerToken(request.headers.get('authorization')));
  const row = presented ? hub.saved.findKey(presented.keyId) : null;
  // Hash even when the id is unknown so a miss costs the same as a wrong secret.
  const secretOk = await savedKeyMatches(presented?.secret ?? '', row?.secret_hash ?? '0'.repeat(64));
  if (!presented || !row || !secretOk || !hub.users.publicById(row.user_id)) {
    return json({ error: '收藏金鑰無效或已撤銷' }, 401);
  }
  const userId = row.user_id;

  const limit = hub.savedLimits.key.attempt(`key:${row.key_id}`);
  if (!limit.ok) return tooMany(limit);

  const read = await readLimitedText(request, MAX_BODY_BYTES);
  if (!read.ok) return json({ error: '內容太大' }, 413);
  const body = parseIngestBody(read.text);
  if (!body.ok) return json({ error: body.error }, body.status);

  // Same link as one already saved: answer before spending the model / geocoder budget.
  const mine = hub.saved.list('personal', userId);
  const linkKey = body.url ? sourceKey(body.url) : '';
  const sameLink = linkKey ? mine.find((r) => sourceKey(r.source_url) === linkKey) : null;
  if (sameLink) return duplicateReply(hub, sameLink);

  const { result, columns } = await extractColumns(hub, { url: body.url, text: body.text });
  if (!result.sourceUrl && !body.text) return json({ error: '不支援這個網址，請一併分享文字內容' }, 400);

  // Short links are now expanded, and the position is known: same post or same shop as an earlier one.
  const dupe = findDuplicate({ ...columns, source_url: result.sourceUrl }, mine);
  if (dupe) return duplicateReply(hub, dupe.row);
  if (mine.length >= MAX_PLACES_PER_LIST) return json({ error: FULL }, 409);
  const stored = hub.saved.insert({
    scope: 'personal',
    user_id: userId,
    ...columns,
    source_url: result.sourceUrl,
    source_text: body.text,
  });
  const place = present(hub, stored);
  console.log(`[saved] ingest extractor=${result.via} ai=${result.ai}`);
  return json({
    ok: true,
    extractor: result.via,
    ai: result.ai,
    created: true,
    status: place.status,
    message: resultMessage(place, { created: true }),
    place,
  });
}

/** Returns a Response, or null when the path is not a saved-places route. */
export async function handleSaved(hub, request, url) {
  const { pathname } = url;
  if (!pathname.startsWith('/api/saved')) return null;
  const method = request.method;

  if (method === 'POST' && pathname === '/api/saved/ingest') return ingest(hub, request);

  const parts = pathname.split('/').filter(Boolean); // ['api','saved', ...]
  const auth = await hub.bearerUser(request);
  if (auth.error) return auth.error;
  const user = auth.user;

  if (parts.length === 3 && parts[2] === 'key') {
    if (method === 'GET') return json(hub.saved.keyInfo(user.id));
    if (method === 'POST') {
      const made = await hub.saved.createKey(user.id);
      return json({ key: made.key, createdAt: made.createdAt, hasKey: true }, 201, { 'Cache-Control': 'no-store' });
    }
    if (method === 'DELETE') {
      hub.saved.revokeKey(user.id);
      return json({ hasKey: false, createdAt: null });
    }
    return null;
  }

  if (parts.length === 2 && method === 'GET') {
    const scope = url.searchParams.get('scope') === 'shared' ? 'shared' : 'mine';
    if (scope === 'shared' && !isMember(hub, user.id)) return json({ error: NOT_MEMBER }, 403);
    const rows = hub.saved.list(scope === 'shared' ? 'shared' : 'personal', user.id);
    const sharedRows = scope === 'mine' ? hub.saved.list('shared') : null;
    return json({ scope, places: rows.map((row) => present(hub, row, user.id, sharedRows)) });
  }

  const id = parts[2];
  const row = id ? hub.saved.get(id) : null;
  if (!row) return json({ error: '找不到這筆收藏' }, 404);
  // Someone else's private place looks the same as a missing one.
  if (row.scope === 'personal' && row.user_id !== user.id) return json({ error: '找不到這筆收藏' }, 404);
  if (row.scope === 'shared' && !isMember(hub, user.id)) return json({ error: NOT_MEMBER }, 403);

  // Companions can read and add a shared place to the plan; only who shared it can change or remove it.
  if (row.scope === 'shared' && row.user_id !== user.id && (method === 'PATCH' || method === 'DELETE')) {
    return json({ error: SHARER_ONLY }, 403);
  }

  if (parts.length === 3 && method === 'DELETE') {
    hub.saved.remove(row.id);
    return json({ ok: true });
  }

  if (parts.length === 3 && method === 'PATCH') {
    const limit = hub.savedLimits.user.attempt(`user:${user.id}`);
    if (!limit.ok) return tooMany(limit);
    const read = await readLimitedText(request, MAX_BODY_BYTES);
    if (!read.ok) return json({ error: '內容太大' }, 413);
    let raw;
    try {
      raw = JSON.parse(read.text || '{}');
    } catch {
      return json({ error: '內容不是有效的 JSON' }, 400);
    }
    const patch = cleanPlacePatch(raw);
    if (!patch.ok) return json({ error: patch.error }, 400);
    const set = { ...patch.set, status: 'ready' };
    const moved = ['name', 'city', 'district', 'country'].some((k) => k in patch.set && patch.set[k] !== row[k]);
    if (moved) {
      const geo = await hub.placeGeocoder?.({ ...row, ...patch.set });
      const area = resolveDistrict(
        { district: 'district' in patch.set ? patch.set.district : row.district, city: 'city' in patch.set ? patch.set.city : row.city },
        geo,
        'ready',
      );
      set.district = area.district;
      set.status = area.status;
      set.lat = geo?.lat ?? null;
      set.lng = geo?.lng ?? null;
      set.precision = geo?.precision ?? null;
      set.address = geo?.address ?? '';
    }
    const updated = hub.saved.update(row.id, set);
    syncSharedCopy(hub, updated);
    return json({ place: present(hub, updated, user.id) });
  }

  if (parts.length === 4 && parts[3] === 'reextract' && method === 'POST') {
    if (row.scope !== 'personal') return json({ error: '找不到這筆收藏' }, 404);
    const limit = hub.savedLimits.user.attempt(`user:${user.id}`);
    if (!limit.ok) return tooMany(limit);
    const read = await readLimitedText(request, MAX_BODY_BYTES);
    if (!read.ok) return json({ error: '內容太大' }, 413);
    let text = row.source_text;
    if (read.text.trim()) {
      const body = parseIngestBody(read.text);
      if (!body.ok) return json({ error: body.error }, body.status);
      text = body.text || text;
    }
    if (!text && !row.source_url) return json({ error: '請貼上描述文字' }, 400);
    const { columns } = await extractColumns(hub, { url: row.source_url, text });
    const updated = hub.saved.update(row.id, { ...columns, source_text: text });
    syncSharedCopy(hub, updated);
    return json({ place: present(hub, updated, user.id) });
  }

  if (parts.length === 4 && parts[3] === 'share' && method === 'POST') {
    if (row.scope !== 'personal') return json({ error: '這筆已經在行程共用清單裡' }, 400);
    if (!isMember(hub, user.id)) return json({ error: NOT_MEMBER }, 403);
    const copy = hub.saved.findSharedCopy(row.id);
    if (copy) return json({ place: present(hub, copy, user.id), already: true });
    // Someone (maybe the same person) already shared this post or shop: no second card, just record who else saved it.
    const dupe = findDuplicate(row, hub.saved.list('shared'));
    if (dupe) {
      const noted = hub.saved.addAlsoSavedBy(dupe.row.id, user.id);
      return json({ place: present(hub, noted, user.id), already: true, duplicate: true, message: ALREADY_SHARED });
    }
    if (hub.saved.count('shared', user.id) >= MAX_PLACES_PER_LIST) return json({ error: FULL }, 409);
    const { id: sourceId, scope, user_id, created_at, updated_at, source_text, ...rest } = row;
    void scope; void user_id; void created_at; void updated_at; void source_text;
    const shared = hub.saved.insert({ ...rest, scope: 'shared', user_id: user.id, shared_from: sourceId, source_text: '' });
    return json({ place: present(hub, shared, user.id), already: false }, 201);
  }

  return null;
}
