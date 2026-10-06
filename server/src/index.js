import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeedState, ROOM_CODE } from './seed.js';
import {
  TRAVEL_MODES,
  computeLegRoute,
  mergeLegEstimate,
  normalizeTripState,
  reconcileLegs,
  setLegMode,
  stripLegEstimates,
} from './legs.js';
import { lookupPlace, placeFailureMessage, redactSecrets, serverMapsKey } from './googleMaps.js';
import { correctSeedState } from './seedGeocode.js';
import { applyStopPatch } from './stopEdit.js';
import { applyLodgingPatch } from './lodgingEdit.js';
import { getWeather } from './weather.js';
import { getJmaWarnings } from './jmaWarnings.js';
import { getJrStatus } from './jrStatus.js';
import { getTripAlerts } from './tripAlerts.js';
import {
  addMember,
  addSettlement,
  deleteExpense,
  deleteSettlement,
  ensureBill,
  isTripMember,
  memberAddAllowed,
  removeMember,
  upsertExpense,
} from './split.js';
import { createFxBook, parseOverride, presentFx } from './fx.js';
import { BUCKET_ENV_VARS, startPeriodicBackup } from './backup.js';
import { loadPersistedTrip, shouldApplySeedCorrection } from './persist.js';
import { createUserStore } from './users.js';
import { collaborativeTripReadable, NOT_COMPANION_ERROR, tripMemberAddAllowed } from './memberAccess.js';
import { clientIp } from './clientIp.js';
import { createRegisterRateLimiter } from './registerRateLimit.js';
import { toPublicShare } from './shareTrip.js';

export { clientIp };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Production and local dev keep data/ next to the repo. TRIP_DATA_DIR is only for isolated tests.
const DATA_DIR = process.env.TRIP_DATA_DIR
  ? path.resolve(process.env.TRIP_DATA_DIR)
  : path.resolve(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FX_POLL_MS = 3 * 60 * 1000;
const FX_MIN_INTERVAL_MS = 90 * 1000
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
const isProd = process.env.NODE_ENV === 'production';
const JWT_SECRET = (() => {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  if (isProd) {
    console.error('[server] Refusing to start: JWT_SECRET is required when NODE_ENV=production');
    process.exit(1);
  }
  // Dev-only fallback — never rely on this in production
  return 'hokkaido-collab-demo-secret-2027';
})();
const PORT = Number(process.env.PORT) || 3001;

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, credentials: true },
});

/** Accounts only. Writes data/users.json and does not read or replace data/state.json. */
const userStore = createUserStore({ dataFile: USERS_FILE });

function signUser(user) {
  const token = jwt.sign(
    { id: user.id, username: user.username, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
  return { token, user };
}

function saveState(state) {
  const tmp = `${STATE_FILE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    console.warn('saveState failed', e.message);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* the previous state.json is left in place */
    }
  }
}

let loadedTrip;
try {
  loadedTrip = loadPersistedTrip({
    dataDir: DATA_DIR,
    nodeEnv: process.env.NODE_ENV,
    createSeed: createSeedState,
  });
} catch (err) {
  console.error(`[server] ${err.message}`);
  process.exit(1);
}
let tripState = loadedTrip.source === 'file' ? loadedTrip.state : normalizeTripState(ensureBill(loadedTrip.state));
const loadedFromFile = loadedTrip.source === 'file';
const fxBook = createFxBook(tripState.fx);
tripState = { ...tripState, fx: fxBook.get() };
const roomPresence = new Map(); // roomCode -> Map(socketId -> {userId, displayName})

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: '未登入' });
  const parsed = parseToken(token);
  if (parsed.status !== 'ok') return res.status(401).json({ error: '登入已過期' });
  req.user = parsed.user;
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    routing: serverMapsKey() ? 'google' : 'osrm',
  });
});

const registerRateLimiter = createRegisterRateLimiter();
const REGISTER_RATE_ERROR = '註冊太多次，請一小時後再試';

/**
 * Add a registered account to HOKKAIDO2027.
 * Uses addMember so the stored record is `{ id }` only, the same shape as a
 * self-add. The original stops, ledger, and existing member entries are kept.
 * Already-present accounts are left untouched.
 */
function autoJoinCompanion(user) {
  if (!user || typeof user.id !== 'string' || !user.id.trim()) return { ok: false, added: false };
  if (isTripMember(tripState, user.id)) return { ok: true, added: false };
  const roster = [{ id: user.id, username: user.username, displayName: user.displayName }];
  const result = addMember(tripState, { username: user.username }, roster);
  if (!result.ok) {
    console.warn(`[members] auto-join skipped: ${result.error}`);
    return { ok: false, added: false, error: result.error };
  }
  const created = result.state.members.find((member) => member.id === user.id);
  if (!created) return { ok: false, added: false };
  const members = Array.isArray(tripState.members) ? tripState.members : [];
  tripState = {
    ...tripState,
    members: [...members, { id: created.id }],
    updatedAt: new Date().toISOString(),
  };
  publishAutoJoin();
  return { ok: true, added: true };
}

function publishAutoJoin() {
  saveState(tripState);
  const codes = new Set([ROOM_CODE]);
  for (const code of roomPresence.keys()) codes.add(code);
  const payload = tripForClient();
  for (const code of codes) {
    evictBlockedCompanions(code);
    io.to(code).emit('trip:update', payload);
  }
}

app.post('/api/login', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = await userStore.authenticate(body.username, body.password);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  if (!userStore.isDemoAccount(result.user.id)) autoJoinCompanion(result.user);
  res.json(signUser(result.user));
});

app.post('/api/register', async (req, res) => {
  if (!registerRateLimiter.attempt(clientIp(req))) {
    return res.status(429).json({ error: REGISTER_RATE_ERROR });
  }
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = await userStore.register({ username: body.username, password: body.password });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  autoJoinCompanion(result.user);
  res.status(201).json(signUser(result.user));
});

app.get('/api/fx', async (_req, res) => {
  res.json(await refreshFx());
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/share', (_req, res) => {
  res.json(toPublicShare(tripState));
});

app.get('/api/trip', authMiddleware, (req, res) => {
  if (!collaborativeTripReadable(tripState, req.user.id)) {
    return res.status(403).json({ error: NOT_COMPANION_ERROR });
  }
  res.json(tripForClient());
});

app.get('/api/places', authMiddleware, async (req, res) => {
  if (!isTripMember(tripState, req.user.id)) {
    return res.status(403).json({ error: '只有這趟行程的旅伴可以這樣做' });
  }
  const q = String(req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: '請輸入地點' });
  if (q.length > 160) return res.status(400).json({ error: '查詢過長' });
  const key = serverMapsKey();
  if (!key) return res.status(503).json({ error: '伺服器未設定 Google 金鑰' });
  try {
    const place = await lookupPlace(q, key, { bias: 'circle:120000@43.4,142.0' });
    if (!place) return res.status(404).json({ error: '找不到地點' });
    res.json({ name: place.name, address: place.address, lat: place.lat, lng: place.lng });
  } catch (e) {
    const detail = redactSecrets(e?.message || '');
    const error = placeFailureMessage(detail);
    console.warn('[places]', error, detail.slice(0, 180));
    res.status(502).json({ error });
  }
});

app.get('/api/route', async (req, res) => {
  const fromLat = Number(req.query.fromLat);
  const fromLng = Number(req.query.fromLng);
  const toLat = Number(req.query.toLat);
  const toLng = Number(req.query.toLng);
  const mode = String(req.query.mode || 'walk');
  if (![fromLat, fromLng, toLat, toLng].every((n) => Number.isFinite(n))) {
    return res.status(400).json({ error: '座標不完整' });
  }
  if (
    Math.abs(fromLat) > 90 ||
    Math.abs(toLat) > 90 ||
    Math.abs(fromLng) > 180 ||
    Math.abs(toLng) > 180
  ) {
    return res.status(400).json({ error: '座標超出範圍' });
  }
  if (!TRAVEL_MODES.includes(mode)) {
    return res.status(400).json({ error: '交通方式不正確' });
  }
  const result = await computeLegRoute(
    { lat: fromLat, lng: fromLng },
    { lat: toLat, lng: toLng },
    mode,
  );
  res.json(result);
});

app.get('/api/weather', async (_req, res) => {
  const result = await getWeather();
  res.status(result.status).json(result.body);
});

app.get('/api/trip-alerts', async (_req, res) => {
  const body = await getTripAlerts();
  res.json(body);
});

function presentMembers(members) {
  return (Array.isArray(members) ? members : []).flatMap((member) => {
    if (!member || typeof member !== 'object' || typeof member.id !== 'string') return [];
    const account = userStore.publicById(member.id);
    if (account) return [account];
    const displayName = String(member.displayName || '').trim();
    return [{ id: member.id, displayName: displayName || '（未知帳號）' }];
  });
}

function tripForClient() {
  return { ...tripState, members: presentMembers(tripState.members), fx: presentFx(tripState.fx) };
}

function requireTripMember(socket, token, ack) {
  const parsed = parseToken(token);
  if (parsed.status === 'missing-account') {
    socket.emit('session:required');
    const error = '登入已過期';
    socket.emit('error:auth', { error });
    ackResult(ack, { ok: false, error });
    return null;
  }
  if (parsed.status !== 'ok') {
    const error = '請先登入才能編輯';
    socket.emit('error:auth', { error });
    ackResult(ack, { ok: false, error });
    return null;
  }
  const user = parsed.user;
  if (!isTripMember(tripState, user.id)) {
    const error = '只有這趟行程的旅伴可以這樣做';
    socket.emit('error:auth', { error });
    ackResult(ack, { ok: false, error });
    return null;
  }
  return user;
}

function evictBlockedCompanions(roomCode) {
  const code = roomCode || ROOM_CODE;
  const presence = roomPresence.get(code);
  if (!presence) return;
  let changed = false;
  for (const [socketId, meta] of [...presence.entries()]) {
    if (collaborativeTripReadable(tripState, meta?.userId)) continue;
    presence.delete(socketId);
    changed = true;
    const sock = io.sockets.sockets.get(socketId);
    if (!sock) continue;
    if (typeof sock.data?.markLeft === 'function') sock.data.markLeft();
    sock.leave(code);
    sock.emit('companion:required', { error: NOT_COMPANION_ERROR });
  }
  if (!changed) return;
  io.to(code).emit('presence:update', {
    online: presenceList(code),
    count: presenceList(code).length,
  });
}

function broadcastTrip(roomCode = ROOM_CODE) {
  evictBlockedCompanions(roomCode);
  io.to(roomCode).emit('trip:update', tripForClient());
  saveState(tripState);
}

function publishFx() {
  tripState = { ...tripState, fx: fxBook.get() };
  saveState(tripState);
  const payload = presentFx(tripState.fx);
  for (const code of [...roomPresence.keys()]) {
    evictBlockedCompanions(code);
    io.to(code).emit('fx:update', payload);
  }
}

async function refreshFx({ force = false, minIntervalMs = FX_MIN_INTERVAL_MS } = {}) {
  const before = JSON.stringify(fxBook.get());
  await fxBook.refresh({ force, minIntervalMs });
  const next = JSON.stringify(fxBook.get());
  if (next !== before) publishFx();
  return presentFx(fxBook.get());
}

let enrichGen = 0;

function legNeedsRoute(leg) {
  return leg.distanceM == null || !leg.summary || !Array.isArray(leg.geometry) || leg.geometry.length < 2;
}

function scheduleEnrich(roomCode = ROOM_CODE) {
  const gen = ++enrichGen;
  const room = roomCode || ROOM_CODE;
  const pending = (tripState.legs || []).filter(legNeedsRoute);
  if (!pending.length) return;

  const workers = Math.min(4, pending.length);
  let cursor = 0;

  const apply = (leg, est) => {
    const current = (tripState.legs || []).find((l) => l.id === leg.id);
    if (!current || current.mode !== leg.mode || !legNeedsRoute(current)) return;
    tripState = {
      ...tripState,
      legs: tripState.legs.map((l) => (l.id === leg.id ? mergeLegEstimate(l, est) : l)),
      updatedAt: new Date().toISOString(),
    };
    broadcastTrip(room);
  };

  const worker = async () => {
    while (cursor < pending.length) {
      if (gen !== enrichGen) return;
      const leg = pending[cursor++];
      const from = tripState.stops.find((s) => s.id === leg.fromStopId);
      const to = tripState.stops.find((s) => s.id === leg.toStopId);
      if (!from || !to) continue;
      const est = await computeLegRoute(from, to, leg.mode);
      if (gen !== enrichGen) return;
      apply(leg, est);
    }
  };

  Promise.all(Array.from({ length: workers }, () => worker())).catch((err) => {
    console.warn('[route] enrich failed', err?.message || err);
  });
}

function publish(roomCode = ROOM_CODE, { enrich = true } = {}) {
  tripState = normalizeTripState(ensureBill({
    ...tripState,
    updatedAt: new Date().toISOString(),
  }));
  broadcastTrip(roomCode);
  if (enrich) scheduleEnrich(roomCode);
}

function saveBill(roomCode = ROOM_CODE) {
  tripState = ensureBill({
    ...tripState,
    updatedAt: new Date().toISOString(),
  });
  broadcastTrip(roomCode);
}

function ackResult(ack, result) {
  if (typeof ack === 'function') ack(result);
}

function presenceList(roomCode) {
  const map = roomPresence.get(roomCode);
  if (!map) return [];
  return [...map.values()];
}

io.on('connection', (socket) => {
  let joinedRoom = null;
  socket.data.markLeft = () => {
    joinedRoom = null;
  };

  socket.on('room:join', (payload, ack) => {
    const body = payload && typeof payload === 'object' ? payload : {};
    const { roomCode, token } = body;
    if (joinedRoom) {
      socket.leave(joinedRoom);
      const prev = roomPresence.get(joinedRoom);
      if (prev) {
        prev.delete(socket.id);
        io.to(joinedRoom).emit('presence:update', {
          online: presenceList(joinedRoom),
          count: presenceList(joinedRoom).length,
        });
      }
      joinedRoom = null;
    }
    const parsed = parseToken(token);
    if (parsed.status !== 'ok') {
      if (token) socket.emit('session:required');
      const error = parsed.status === 'missing' ? '請先登入' : '登入已過期';
      ackResult(ack, { ok: false, error });
      return;
    }
    const code = String(roomCode || ROOM_CODE).toUpperCase();
    if (!collaborativeTripReadable(tripState, parsed.user.id)) {
      socket.emit('companion:required', { error: NOT_COMPANION_ERROR });
      ackResult(ack, { ok: false, error: NOT_COMPANION_ERROR });
      return;
    }
    const user = parsed.user;
    joinedRoom = code;
    socket.join(code);
    if (!roomPresence.has(code)) roomPresence.set(code, new Map());
    roomPresence.get(code).set(socket.id, {
      socketId: socket.id,
      userId: user.id,
      displayName: user.displayName || user.username || '旅伴',
      username: user.username || null,
    });
    socket.emit('trip:update', tripForClient());
    socket.emit('fx:update', presentFx(tripState.fx));
    io.to(code).emit('presence:update', {
      online: presenceList(code),
      count: presenceList(code).length,
    });
    ackResult(ack, { ok: true });
  });

  socket.on('trip:reorder', ({ day, orderedIds, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const dayStops = tripState.stops.filter((s) => s.day === day);
    const others = tripState.stops.filter((s) => s.day !== day);
    const map = new Map(dayStops.map((s) => [s.id, s]));
    const reordered = orderedIds.map((id) => map.get(id)).filter(Boolean);
    // append any missing
    for (const s of dayStops) {
      if (!reordered.find((r) => r.id === s.id)) reordered.push(s);
    }
    tripState = {
      ...tripState,
      stops: [...others, ...reordered].sort((a, b) => a.day - b.day || 0),
      updatedAt: new Date().toISOString(),
    };
    // Keep day order: rebuild by day order from days array
    const byDay = [];
    for (const d of tripState.days) {
      byDay.push(...tripState.stops.filter((s) => s.day === d.day));
    }
    tripState.stops = byDay;
    publish(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:add', ({ stop, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const id = `s${Date.now()}`;
    const newStop = {
      id,
      day: stop.day,
      date: stop.date || tripState.days.find((d) => d.day === stop.day)?.date || '',
      title: stop.title || '新站點',
      time: stop.time || '',
      lat: Number(stop.lat) || 43.06,
      lng: Number(stop.lng) || 141.35,
      notes: stop.notes || '',
    };
    const idx = tripState.stops.findIndex((s) => s.day > newStop.day);
    const stops = [...tripState.stops];
    // insert at end of that day
    let insertAt = stops.length;
    for (let i = 0; i < stops.length; i++) {
      if (stops[i].day === newStop.day) insertAt = i + 1;
      else if (stops[i].day > newStop.day) {
        insertAt = i;
        break;
      }
    }
    stops.splice(insertAt, 0, newStop);
    tripState = { ...tripState, stops };
    publish(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:updateStop', ({ id, patch, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const result = applyStopPatch(tripState, id, patch);
    if (!result.ok) {
      const error = result.error || '無法更新站點';
      socket.emit('error:edit', { error });
      ackResult(ack, { ok: false, error });
      return;
    }
    if (result.unchanged) {
      ackResult(ack, { ok: true, unchanged: true });
      return;
    }
    tripState = result.state;
    // A title-only rename must not recompute routes. Coordinate edits still do.
    publish(joinedRoom || ROOM_CODE, { enrich: !result.titleOnly });
    ackResult(ack, { ok: true });
  });

  socket.on('trip:delete', ({ id, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    tripState = {
      ...tripState,
      stops: tripState.stops.filter((s) => s.id !== id),
    };
    publish(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:setLegMode', ({ fromStopId, toStopId, mode, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const next = setLegMode(tripState, fromStopId, toStopId, mode);
    if (!next.changed) return;
    tripState = next.state;
    publish(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:setLodging', ({ lodging, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const result = applyLodgingPatch(tripState, lodging);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    if (result.unchanged) {
      ackResult(ack, { ok: true, unchanged: true });
      return;
    }
    tripState = result.state;
    publish(joinedRoom || ROOM_CODE, { enrich: false });
    ackResult(ack, { ok: true });
  });

  socket.on('trip:reset', ({ token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    if (isProd || loadedFromFile) {
      const error = '這份行程是從已儲存的資料讀進來的，不會用種子覆蓋';
      socket.emit('error:edit', { error });
      ackResult(ack, { ok: false, error });
      return;
    }
    const members = tripState.members;
    const expenses = tripState.expenses;
    const settlements = tripState.settlements;
    const fx = tripState.fx;
    tripState = { ...createSeedState(), members, expenses, settlements, fx };
    publish(joinedRoom || ROOM_CODE, { enrich: false });
    void applySeedCorrection(joinedRoom || ROOM_CODE);
  });

  socket.on('expense:upsert', ({ expense, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const result = upsertExpense(tripState, expense);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    tripState = result.state;
    saveBill(joinedRoom || ROOM_CODE);
    ackResult(ack, { ok: true });
  });

  socket.on('expense:delete', ({ id, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const result = deleteExpense(tripState, id);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    tripState = result.state;
    saveBill(joinedRoom || ROOM_CODE);
    ackResult(ack, { ok: true });
  });

  function beginAccountAdd(token, username, ack) {
    const parsed = parseToken(token);
    if (parsed.status === 'missing-account') {
      socket.emit('session:required');
      const error = '登入已過期';
      socket.emit('error:auth', { error });
      ackResult(ack, { ok: false, error });
      return null;
    }
    if (parsed.status !== 'ok') {
      const error = '請先登入才能編輯';
      socket.emit('error:auth', { error });
      ackResult(ack, { ok: false, error });
      return null;
    }
    const caller = parsed.user;
    const requested = typeof username === 'string' ? username : '';
    if (!requested.trim()) {
      const error = '請輸入已註冊的帳號';
      socket.emit('error:edit', { error });
      ackResult(ack, { ok: false, error });
      return null;
    }
    const account = userStore.findByUsername(requested);
    if (!account) {
      const error = '找不到這個帳號';
      socket.emit('error:edit', { error });
      ackResult(ack, { ok: false, error });
      return null;
    }
    return { caller, requested, account };
  }

  function finishMemberAdd(requested, account, ack) {
    const roster = [{ id: account.id, username: account.username, displayName: account.displayName }];
    const result = addMember(tripState, { username: requested }, roster);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    tripState = result.state;
    saveBill(joinedRoom || ROOM_CODE);
    ackResult(ack, { ok: true });
  }

  socket.on('member:add', ({ username, token }, ack) => {
    const ctx = beginAccountAdd(token, username, ack);
    if (!ctx) return;
    const allowed = memberAddAllowed(tripState, ctx.caller.id, ctx.account.id);
    if (!allowed.ok) {
      socket.emit('error:auth', { error: allowed.error });
      ackResult(ack, allowed);
      return;
    }
    finishMemberAdd(ctx.requested, ctx.account, ack);
  });

  socket.on('trip:addMember', ({ username, token }, ack) => {
    const ctx = beginAccountAdd(token, username, ack);
    if (!ctx) return;
    const allowed = tripMemberAddAllowed(tripState, ctx.caller.id, ctx.account.id);
    if (!allowed.ok) {
      socket.emit('error:auth', { error: allowed.error });
      ackResult(ack, allowed);
      return;
    }
    finishMemberAdd(ctx.requested, ctx.account, ack);
  });

  socket.on('member:rename', (_payload, ack) => {
    const error = '旅伴就是登入帳號，不能另外取名';
    socket.emit('error:edit', { error });
    ackResult(ack, { ok: false, error });
  });

  socket.on('member:remove', ({ id, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const result = removeMember(tripState, id);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    tripState = result.state;
    saveBill(joinedRoom || ROOM_CODE);
    ackResult(ack, { ok: true });
  });

  socket.on('settlement:add', ({ settlement, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const result = addSettlement(tripState, settlement);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    tripState = result.state;
    saveBill(joinedRoom || ROOM_CODE);
    ackResult(ack, { ok: true });
  });

  socket.on('settlement:delete', ({ id, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const result = deleteSettlement(tripState, id);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    tripState = result.state;
    saveBill(joinedRoom || ROOM_CODE);
    ackResult(ack, { ok: true });
  });

  socket.on('fx:override', ({ basis, value, token }, ack) => {
    const verified = requireTripMember(socket, token, ack);
    if (!verified) return;
    const parsed = parseOverride({ basis, value });
    if (!parsed.ok) {
      socket.emit('error:edit', { error: parsed.error });
      ackResult(ack, parsed);
      return;
    }
    fxBook.setOverride({
      twdPerJpy: parsed.twdPerJpy,
      jpyPerTwd: parsed.jpyPerTwd,
      setAt: new Date().toISOString(),
      setBy: verified.displayName,
      setById: verified.id,
    });
    publishFx();
    ackResult(ack, { ok: true, fx: presentFx(fxBook.get()) });
  });

  socket.on('fx:clearOverride', ({ token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    fxBook.clearOverride();
    publishFx();
    ackResult(ack, { ok: true, fx: presentFx(fxBook.get()) });
  });

  socket.on('disconnect', () => {
    if (joinedRoom) {
      const map = roomPresence.get(joinedRoom);
      if (map) {
        map.delete(socket.id);
        io.to(joinedRoom).emit('presence:update', {
          online: presenceList(joinedRoom),
          count: presenceList(joinedRoom).length,
        });
      }
    }
  });
});

function parseToken(token) {
  if (!token || typeof token !== 'string') return { status: 'missing' };
  let user;
  try {
    user = jwt.verify(token, JWT_SECRET);
  } catch {
    return { status: 'invalid' };
  }
  if (!user || typeof user !== 'object' || typeof user.id !== 'string' || !user.id) {
    return { status: 'invalid' };
  }
  if (!userStore.publicById(user.id)) return { status: 'missing-account' };
  return { status: 'ok', user };
}

function dropLegEstimates(state, movedIds) {
  let legs = state.legs;
  for (const id of movedIds) {
    if (id === 'lodging') continue;
    legs = stripLegEstimates(legs, id);
  }
  return { ...state, legs };
}

async function applySeedCorrection(roomCode = ROOM_CODE) {
  // A trip restored from state.json keeps its saved coordinates.
  if (!shouldApplySeedCorrection(loadedTrip.source)) return;
  try {
    const result = await correctSeedState(tripState);
    if (!result.changed) {
      if (result.skipped === 'no-key') {
        console.log('[geocode] GOOGLE_MAPS_SERVER_KEY unset; using committed seed coordinates');
      }
      return;
    }
    tripState = normalizeTripState(dropLegEstimates(result.state, result.movedIds));
    tripState.updatedAt = new Date().toISOString();
    console.log(`[geocode] updated ${result.movedIds.length} seed coordinates`);
    broadcastTrip(roomCode);
  } catch (err) {
    console.warn('[geocode] seed correction failed', err?.message || err);
  } finally {
    scheduleEnrich(roomCode);
  }
}

await userStore.init();
const demoAccountRemoval = userStore.planProductionDemoRemoval(
  (Array.isArray(tripState.members) ? tripState.members : []).flatMap((member) => {
    if (!member || typeof member !== 'object' || typeof member.id !== 'string') return [];
    const id = member.id.trim();
    return id ? [id] : [];
  }),
);

let releaseFirstFx = () => {};
const firstFxSettled = new Promise((resolve) => {
  releaseFirstFx = resolve;
});

let whenBackupStarted = Promise.resolve(null);
try {
  // The listen callback's first refreshFx may write state.json. The startup copy waits for that save.
  const periodicBackup = startPeriodicBackup({
    dataDir: DATA_DIR,
    startupReady: firstFxSettled,
  });
  whenBackupStarted = Promise.resolve(periodicBackup.whenStarted);
  if (!periodicBackup.started) {
    console.log(`[backup] periodic copies are off (${periodicBackup.reason}). Set ${BUCKET_ENV_VARS.join(', ')}.`);
  }
} catch (err) {
  console.warn('[backup] periodic copies were not started', err.message);
}
// Demo rows leave memory before listen. The file rewrite waits until the startup
// backup copy finishes, so that copy still has the pre-removal users.json.
void whenBackupStarted.finally(() => {
  void demoAccountRemoval.commit();
});

// Production: serve Vite build from client/dist (single-port deploy)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
  console.log(`[server] serving static client from ${CLIENT_DIST}`);
} else if (isProd) {
  console.warn('[server] client/dist missing — run `npm run build` before start in production');
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[server] listening on http://0.0.0.0:${PORT} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  if (!isProd) {
    console.log(`[server] room ${ROOM_CODE} | demo users alice/bob password demo1234`);
  } else {
    console.log(`[server] room ${ROOM_CODE}`);
  }
  console.log(`[server] routing ${serverMapsKey() ? 'google' : 'osrm'}`);
  if (shouldApplySeedCorrection(loadedTrip.source)) void applySeedCorrection(ROOM_CODE);
  void refreshFx({ force: true, minIntervalMs: 0 }).finally(releaseFirstFx);
  setInterval(() => {
    void refreshFx({ force: true, minIntervalMs: 0 });
  }, FX_POLL_MS);
  void getJmaWarnings().catch((err) => console.warn('[jma] warmup failed', err?.message || err));
  void getJrStatus().catch((err) => console.warn('[jr] warmup failed', err?.message || err));
});
