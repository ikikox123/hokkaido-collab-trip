import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createSeedState, ROOM_CODE } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
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

/** Demo users with password demo1234 — hash computed at boot */
let users = [];

async function initUsers() {
  const hash = await bcrypt.hash('demo1234', 10);
  users = [
    { id: 'u1', username: 'alice', displayName: 'Alice', passwordHash: hash },
    { id: 'u2', username: 'bob', displayName: 'Bob', passwordHash: hash },
  ];
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('loadState failed, using seed', e.message);
  }
  return createSeedState();
}

function saveState(state) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {
    console.warn('saveState failed', e.message);
  }
}

let tripState = loadState();
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
  res.json({ ok: true, room: ROOM_CODE });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '請輸入帳號與密碼' });
  }
  const user = users.find((u) => u.username === String(username).toLowerCase());
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return res.status(401).json({ error: '帳號或密碼錯誤' });
  }
  const token = jwt.sign(
    { id: user.id, username: user.username, displayName: user.displayName },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
  res.json({
    token,
    user: { id: user.id, username: user.username, displayName: user.displayName },
  });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get('/api/trip', optionalAuth, (_req, res) => {
  res.json(tripState);
});

app.get('/api/weather', async (_req, res) => {
  const cities = [
    { id: 'sapporo', name: '札幌', lat: 43.06, lng: 141.35 },
    { id: 'otaru', name: '小樽', lat: 43.19, lng: 140.99 },
    { id: 'asahikawa', name: '旭川', lat: 43.77, lng: 142.36 },
  ];
  try {
    const results = await Promise.all(
      cities.map(async (c) => {
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${c.lat}&longitude=${c.lng}&current=temperature_2m,weather_code&timezone=Asia%2FTokyo`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`weather ${c.id} ${r.status}`);
        const data = await r.json();
        return {
          ...c,
          temperature: data.current?.temperature_2m ?? null,
          weatherCode: data.current?.weather_code ?? null,
          time: data.current?.time ?? null,
        };
      }),
    );
    res.json({ cities: results, fetchedAt: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: '天氣取得失敗', detail: String(e.message || e) });
  }
});

function broadcastTrip(roomCode = ROOM_CODE) {
  io.to(roomCode).emit('trip:update', tripState);
  saveState(tripState);
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
    socket.emit('trip:update', tripState);
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
    broadcastTrip(joinedRoom || ROOM_CODE);
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
    tripState = { ...tripState, stops, updatedAt: new Date().toISOString() };
    broadcastTrip(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:updateStop', ({ id, patch, token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
    tripState = {
      ...tripState,
      stops: tripState.stops.map((s) => (s.id === id ? { ...s, ...patch, id: s.id } : s)),
      updatedAt: new Date().toISOString(),
    };
    broadcastTrip(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:delete', ({ id, token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
    tripState = {
      ...tripState,
      stops: tripState.stops.filter((s) => s.id !== id),
      updatedAt: new Date().toISOString(),
    };
    broadcastTrip(joinedRoom || ROOM_CODE);
  });

  socket.on('trip:reset', ({ token }) => {
    if (!verifyToken(token)) {
      socket.emit('error:auth', { error: '請先登入才能編輯' });
      return;
    }
    tripState = createSeedState();
    broadcastTrip(joinedRoom || ROOM_CODE);
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

await initUsers();

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
});
