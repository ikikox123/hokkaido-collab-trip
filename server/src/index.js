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
  removeMember,
  upsertExpense,
} from './split.js';
import { createFxBook, parseOverride, presentFx } from './fx.js';
import { loadPersistedTrip, shouldApplySeedCorrection } from './persist.js';
import { createUserStore } from './users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
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
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.warn('saveState failed', e.message);
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
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '登入已過期' });
  }
}

function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {
      /* ignore */
    }
  }
  next();
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    room: ROOM_CODE,
    routing: serverMapsKey() ? 'google' : 'osrm',
  });
});

app.post('/api/login', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = await userStore.authenticate(body.username, body.password);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json(signUser(result.user));
});

app.post('/api/register', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const result = await userStore.register({ username: body.username, password: body.password });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.status(201).json(signUser(result.user));
});

app.get('/api/fx', async (_req, res) => {
  res.json(await refreshFx());
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/trip', optionalAuth, (_req, res) => {
  res.json(tripForClient());
});

app.get('/api/places', authMiddleware, async (req, res) => {
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
  const user = verifyToken(token);
  if (!user) {
    const error = '請先登入才能編輯';
    socket.emit('error:auth', { error });
    ackResult(ack, { ok: false, error });
    return false;
  }
  if (!isTripMember(tripState, user.id)) {
    const error = '只有這趟行程的旅伴可以這樣做';
    socket.emit('error:auth', { error });
    ackResult(ack, { ok: false, error });
    return false;
  }
  return true;
}

function broadcastTrip(roomCode = ROOM_CODE) {
  io.to(roomCode).emit('trip:update', tripForClient());
  saveState(tripState);
}

function publishFx() {
  tripState = { ...tripState, fx: fxBook.get() };
  saveState(tripState);
  io.emit('fx:update', presentFx(tripState.fx));
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

  socket.on('room:join', ({ roomCode, user }) => {
    const code = (roomCode || ROOM_CODE).toUpperCase();
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
    }
    joinedRoom = code;
    socket.join(code);
    if (!roomPresence.has(code)) roomPresence.set(code, new Map());
    roomPresence.get(code).set(socket.id, {
      socketId: socket.id,
      userId: user?.id || null,
      displayName: user?.displayName || '訪客',
      username: user?.username || null,
    });
    socket.emit('trip:update', tripForClient());
    socket.emit('fx:update', presentFx(tripState.fx));
    io.to(code).emit('presence:update', {
      online: presenceList(code),
      count: presenceList(code).length,
    });
  });

  socket.on('trip:reorder', ({ day, orderedIds, token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
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

  socket.on('trip:add', ({ stop, token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
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

  socket.on('trip:updateStop', ({ id, patch, token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
    const result = applyStopPatch(tripState, id, patch);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error || '無法更新站點' });
      return;
    }
    if (result.unchanged) return;
    tripState = result.state;
    // A title-only rename must not recompute routes. Coordinate edits still do.
    publish(joinedRoom || ROOM_CODE, { enrich: !result.titleOnly });
  });

  socket.on('trip:delete', ({ id, token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
    tripState = {
      ...tripState,
      stops: tripState.stops.filter((s) => s.id !== id),
    };
    publish(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:setLegMode', ({ fromStopId, toStopId, mode, token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
    const next = setLegMode(tripState, fromStopId, toStopId, mode);
    if (!next.changed) return;
    tripState = next.state;
    publish(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:reset', ({ token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
    if (loadedFromFile) {
      socket.emit('error:edit', { error: '這份行程是從已儲存的資料讀進來的，不會用種子覆蓋' });
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
    if (!verifyToken(token)) {
      const error = '請先登入才能編輯';
      socket.emit('error:auth', { error });
      ackResult(ack, { ok: false, error });
      return;
    }
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
    if (!verifyToken(token)) {
      const error = '請先登入才能編輯';
      socket.emit('error:auth', { error });
      ackResult(ack, { ok: false, error });
      return;
    }
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

  socket.on('member:add', ({ username, token }, ack) => {
    if (!requireTripMember(socket, token, ack)) return;
    const account = userStore.findByUsername(username);
    const roster = account
      ? [{ id: account.id, username: account.username, displayName: account.displayName }]
      : [];
    const result = addMember(tripState, { username: typeof username === 'string' ? username : '' }, roster);
    if (!result.ok) {
      socket.emit('error:edit', { error: result.error });
      ackResult(ack, result);
      return;
    }
    tripState = result.state;
    saveBill(joinedRoom || ROOM_CODE);
    ackResult(ack, { ok: true });
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
    const verified = verifyToken(token);
    if (!verified) {
      const error = '請先登入才能編輯';
      socket.emit('error:auth', { error });
      ackResult(ack, { ok: false, error });
      return;
    }
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
    if (!verifyToken(token)) {
      const error = '請先登入才能編輯';
      socket.emit('error:auth', { error });
      ackResult(ack, { ok: false, error });
      return;
    }
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

function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
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
  console.log(`[server] room ${ROOM_CODE} | demo users alice/bob password demo1234`);
  console.log(`[server] routing ${serverMapsKey() ? 'google' : 'osrm'}`);
  if (shouldApplySeedCorrection(loadedTrip.source)) void applySeedCorrection(ROOM_CODE);
  void refreshFx({ force: true, minIntervalMs: 0 });
  setInterval(() => {
    void refreshFx({ force: true, minIntervalMs: 0 });
  }, FX_POLL_MS);
  void getJmaWarnings().catch((err) => console.warn('[jma] warmup failed', err?.message || err));
  void getJrStatus().catch((err) => console.warn('[jr] warmup failed', err?.message || err));
});
