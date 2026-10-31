import { DurableObject } from 'cloudflare:workers';
import { createSeedState, ROOM_CODE } from '../../server/src/seed.js';
import {
  computeLegRoute,
  mergeLegEstimate,
  normalizeTripState,
  setLegMode,
} from '../../server/src/legs.js';
import { lookupPlace, placeFailureMessage, redactSecrets, serverMapsKey } from '../../server/src/googleMaps.js';
import { applyStopPatch } from '../../server/src/stopEdit.js';
import { applyLodgingPatch } from '../../server/src/lodgingEdit.js';
import { applyDayLabel } from '../../server/src/dayLabel.js';
import { cleanStopInfo } from '../../server/src/stopInfo.js';
import { createOsmHoursLookup, parseOpeningHoursQuery } from '../../server/src/osmHours.js';
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
} from '../../server/src/split.js';
import { createFxBook, parseOverride, presentFx } from '../../server/src/fx.js';
import {
  collaborativeTripReadable,
  NOT_COMPANION_ERROR,
  tripMemberAddAllowed,
} from '../../server/src/memberAccess.js';
import { createRegisterRateLimiter } from '../../server/src/registerRateLimit.js';
import { toPublicShare } from '../../server/src/shareTrip.js';
import { signJwt, verifyJwt } from './jwt.js';
import { createUserStore } from './userStore.js';
import { loadDoc, saveDoc } from './docStore.js';
import { migrateSplitFields } from './migrate.js';
import { createSavedStore } from './savedStore.js';
import { createSavedLimiters, handleSaved } from './savedRoutes.js';
import { createPlaceGeocoder } from '../../server/src/nominatimGeocode.js';
import { isSavedKeyToken, KEY_ONLY_FOR_SAVING } from '../../server/src/savedKey.js';

const FX_POLL_MS = 3 * 60 * 1000;
const FX_MIN_INTERVAL_MS = 90 * 1000;
const REGISTER_RATE_ERROR = '註冊太多次，請一小時後再試';
const NOT_IMPORTED_ERROR = '行程資料尚未匯入';
const DEV_JWT_SECRET = 'hokkaido-collab-demo-secret-2027';

function json(body, status = 200) {
  return Response.json(body, { status });
}

function legNeedsRoute(leg) {
  return leg.distanceM == null || !leg.summary || !Array.isArray(leg.geometry) || leg.geometry.length < 2;
}

/**
 * One instance holds the whole app: the trip, accounts, and every WebSocket.
 * Mirrors server/src/index.js event for event; Socket.io rooms become a
 * `room` field on each socket's attachment.
 */
export class TripHub extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.production = env.ENVIRONMENT === 'production';
    this.users = createUserStore(this.sql, { production: this.production });
    this.registerLimiter = createRegisterRateLimiter();
    this.osmOpeningHours = createOsmHoursLookup();
    this.saved = createSavedStore(this.sql);
    this.savedLimits = createSavedLimiters();
    this.placeGeocoder = createPlaceGeocoder();
    this.enrichGen = 0;
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    ctx.blockConcurrencyWhile(async () => {
      await this.users.init();
      this.loadTrip();
      if (!this.production) this.saved.seedDemo((name) => loadDoc(this.sql, name), (name, value) => saveDoc(this.sql, name, value));
    });
  }

  // ---------- storage ----------

  loadTrip() {
    const meta = loadDoc(this.sql, 'meta');
    const saved = loadDoc(this.sql, 'state');
    if (saved) {
      this.source = meta?.source || 'import';
      this.tripState = migrateSplitFields(saved);
    } else if (this.production) {
      // Production never seeds. It waits for /api/admin/import.
      this.source = null;
      this.tripState = null;
    } else {
      this.source = 'seed';
      this.tripState = normalizeTripState(ensureBill(createSeedState()));
      saveDoc(this.sql, 'meta', { source: 'seed' });
      this.saveState();
    }
    this.fxBook = createFxBook(this.tripState?.fx);
    if (this.tripState) this.tripState = { ...this.tripState, fx: this.fxBook.get() };
  }

  saveState() {
    if (this.tripState) saveDoc(this.sql, 'state', this.tripState);
  }

  get jwtSecret() {
    if (this.env.JWT_SECRET) return this.env.JWT_SECRET;
    if (this.production) throw new Error('JWT_SECRET is required in production');
    return DEV_JWT_SECRET;
  }

  // ---------- auth ----------

  async signUser(user) {
    const token = await signJwt(
      { id: user.id, username: user.username, displayName: user.displayName },
      this.jwtSecret,
    );
    return { token, user };
  }

  async parseToken(token) {
    if (!token || typeof token !== 'string') return { status: 'missing' };
    if (isSavedKeyToken(token)) return { status: 'saved-key' };
    const user = await verifyJwt(token, this.jwtSecret);
    if (!user || typeof user.id !== 'string' || !user.id) return { status: 'invalid' };
    if (!this.users.publicById(user.id)) return { status: 'missing-account' };
    return { status: 'ok', user };
  }

  async bearerUser(request) {
    const header = request.headers.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return { error: json({ error: '未登入' }, 401) };
    if (isSavedKeyToken(token)) return { error: json({ error: KEY_ONLY_FOR_SAVING }, 403) };
    const parsed = await this.parseToken(token);
    if (parsed.status !== 'ok') return { error: json({ error: '登入已過期' }, 401) };
    return { user: parsed.user };
  }

  // ---------- presentation ----------

  presentMembers(members) {
    return (Array.isArray(members) ? members : []).flatMap((member) => {
      if (!member || typeof member !== 'object' || typeof member.id !== 'string') return [];
      const account = this.users.publicById(member.id);
      if (account) return [account];
      const displayName = String(member.displayName || '').trim();
      return [{ id: member.id, displayName: displayName || '（未知帳號）' }];
    });
  }

  tripForClient() {
    const state = this.tripState;
    return { ...state, members: this.presentMembers(state.members), fx: presentFx(state.fx) };
  }

  // ---------- sockets ----------

  sockets() {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.OPEN);
  }

  meta(ws) {
    return ws.deserializeAttachment() || {};
  }

  setMeta(ws, patch) {
    ws.serializeAttachment({ ...this.meta(ws), ...patch });
  }

  send(ws, event, data) {
    try {
      ws.send(JSON.stringify({ t: 'event', event, data }));
    } catch {
      /* socket already closing */
    }
  }

  roomSockets(code, exclude) {
    return this.sockets().filter((ws) => ws !== exclude && this.meta(ws).room === code);
  }

  rooms() {
    const codes = new Set();
    for (const ws of this.sockets()) {
      const room = this.meta(ws).room;
      if (room) codes.add(room);
    }
    return codes;
  }

  emitRoom(code, event, data, exclude) {
    for (const ws of this.roomSockets(code, exclude)) this.send(ws, event, data);
  }

  presenceList(code, exclude) {
    return this.roomSockets(code, exclude).map((ws) => this.meta(ws).presence).filter(Boolean);
  }

  emitPresence(code, exclude) {
    const online = this.presenceList(code, exclude);
    this.emitRoom(code, 'presence:update', { online, count: online.length }, exclude);
  }

  evictBlockedCompanions(roomCode) {
    const code = roomCode || ROOM_CODE;
    let changed = false;
    for (const ws of this.roomSockets(code)) {
      const { presence } = this.meta(ws);
      if (collaborativeTripReadable(this.tripState, presence?.userId)) continue;
      this.setMeta(ws, { room: null, presence: null });
      this.send(ws, 'companion:required', { error: NOT_COMPANION_ERROR });
      changed = true;
    }
    if (changed) this.emitPresence(code);
  }

  broadcastTrip(roomCode = ROOM_CODE) {
    this.evictBlockedCompanions(roomCode);
    this.emitRoom(roomCode, 'trip:update', this.tripForClient());
    this.saveState();
  }

  publish(roomCode = ROOM_CODE, { enrich = true } = {}) {
    this.tripState = normalizeTripState(ensureBill({ ...this.tripState, updatedAt: new Date().toISOString() }));
    this.broadcastTrip(roomCode);
    if (enrich) this.scheduleEnrich(roomCode);
  }

  saveBill(roomCode = ROOM_CODE) {
    this.tripState = ensureBill({ ...this.tripState, updatedAt: new Date().toISOString() });
    this.broadcastTrip(roomCode);
  }

  scheduleEnrich(roomCode = ROOM_CODE) {
    const gen = ++this.enrichGen;
    const pending = (this.tripState.legs || []).filter(legNeedsRoute);
    if (!pending.length) return;
    let cursor = 0;

    const apply = (leg, est) => {
      const current = (this.tripState.legs || []).find((l) => l.id === leg.id);
      if (!current || current.mode !== leg.mode || !legNeedsRoute(current)) return;
      this.tripState = {
        ...this.tripState,
        legs: this.tripState.legs.map((l) => (l.id === leg.id ? mergeLegEstimate(l, est) : l)),
        updatedAt: new Date().toISOString(),
      };
      this.broadcastTrip(roomCode);
    };

    const worker = async () => {
      while (cursor < pending.length) {
        if (gen !== this.enrichGen) return;
        const leg = pending[cursor++];
        const from = this.tripState.stops.find((s) => s.id === leg.fromStopId);
        const to = this.tripState.stops.find((s) => s.id === leg.toStopId);
        if (!from || !to) continue;
        const est = await computeLegRoute(from, to, leg.mode);
        if (gen !== this.enrichGen) return;
        apply(leg, est);
      }
    };

    const run = Promise.all(Array.from({ length: Math.min(4, pending.length) }, () => worker())).catch((err) => {
      console.warn('[route] enrich failed', err?.message || err);
    });
    this.ctx.waitUntil(run);
  }

  // ---------- fx ----------

  publishFx() {
    this.tripState = { ...this.tripState, fx: this.fxBook.get() };
    this.saveState();
    const payload = presentFx(this.tripState.fx);
    for (const code of this.rooms()) {
      this.evictBlockedCompanions(code);
      this.emitRoom(code, 'fx:update', payload);
    }
  }

  async refreshFx({ force = false, minIntervalMs = FX_MIN_INTERVAL_MS } = {}) {
    const before = JSON.stringify(this.fxBook.get());
    await this.fxBook.refresh({ force, minIntervalMs });
    if (this.tripState && JSON.stringify(this.fxBook.get()) !== before) this.publishFx();
    return presentFx(this.fxBook.get());
  }

  async ensureFxAlarm() {
    if ((await this.ctx.storage.getAlarm()) == null) {
      await this.ctx.storage.setAlarm(Date.now() + FX_POLL_MS);
    }
  }

  /** Polls the rate while someone is connected. Idle rooms stop polling. */
  async alarm() {
    if (!this.tripState || this.sockets().length === 0) return;
    await this.refreshFx({ force: true, minIntervalMs: 0 });
    await this.ctx.storage.setAlarm(Date.now() + FX_POLL_MS);
  }

  // ---------- auto-join ----------

  autoJoinCompanion(user) {
    if (!this.tripState || !user?.id) return;
    if (isTripMember(this.tripState, user.id)) return;
    const roster = [{ id: user.id, username: user.username, displayName: user.displayName }];
    const result = addMember(this.tripState, { username: user.username }, roster);
    if (!result.ok) {
      console.warn(`[members] auto-join skipped: ${result.error}`);
      return;
    }
    const created = result.state.members.find((member) => member.id === user.id);
    if (!created) return;
    const members = Array.isArray(this.tripState.members) ? this.tripState.members : [];
    this.tripState = {
      ...this.tripState,
      members: [...members, { id: created.id }],
      updatedAt: new Date().toISOString(),
    };
    this.saveState();
    const codes = new Set([ROOM_CODE, ...this.rooms()]);
    const payload = this.tripForClient();
    for (const code of codes) {
      this.evictBlockedCompanions(code);
      this.emitRoom(code, 'trip:update', payload);
    }
  }

  // ---------- HTTP ----------

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      pair[1].serializeAttachment({ sid: crypto.randomUUID(), room: null, presence: null });
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    try {
      return await this.route(request, url);
    } catch (err) {
      console.error('[api]', err?.stack || err);
      return json({ error: '伺服器錯誤' }, 500);
    }
  }

  async readBody(request) {
    try {
      const body = await request.json();
      return body && typeof body === 'object' ? body : {};
    } catch {
      return {};
    }
  }

  async route(request, url) {
    const { pathname } = url;
    const method = request.method;

    if (pathname.startsWith('/api/admin/')) return this.admin(request, pathname);

    if (method === 'POST' && pathname === '/api/login') {
      const body = await this.readBody(request);
      const result = await this.users.authenticate(body.username, body.password);
      if (!result.ok) return json({ error: result.error }, result.status);
      if (!this.users.isDemoAccount(result.user.id)) this.autoJoinCompanion(result.user);
      return json(await this.signUser(result.user));
    }

    if (method === 'POST' && pathname === '/api/register') {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      if (!this.registerLimiter.attempt(ip)) return json({ error: REGISTER_RATE_ERROR }, 429);
      const body = await this.readBody(request);
      const result = await this.users.register({ username: body.username, password: body.password });
      if (!result.ok) return json({ error: result.error }, result.status);
      this.autoJoinCompanion(result.user);
      return json(await this.signUser(result.user), 201);
    }

    const savedResponse = await handleSaved(this, request, url);
    if (savedResponse) return savedResponse;

    if (method === 'GET' && pathname === '/api/fx') return json(await this.refreshFx());

    if (method === 'GET' && pathname === '/api/me') {
      const auth = await this.bearerUser(request);
      if (auth.error) return auth.error;
      return json({ user: auth.user });
    }

    if (method === 'GET' && pathname === '/api/share') {
      if (!this.tripState) return json({ error: NOT_IMPORTED_ERROR }, 503);
      return json(toPublicShare(this.tripState));
    }

    if (method === 'GET' && pathname === '/api/trip') {
      const auth = await this.bearerUser(request);
      if (auth.error) return auth.error;
      if (!this.tripState) return json({ error: NOT_IMPORTED_ERROR }, 503);
      if (!collaborativeTripReadable(this.tripState, auth.user.id)) return json({ error: NOT_COMPANION_ERROR }, 403);
      return json(this.tripForClient());
    }

    if (method === 'GET' && pathname === '/api/places') {
      const auth = await this.bearerUser(request);
      if (auth.error) return auth.error;
      if (!this.tripState || !isTripMember(this.tripState, auth.user.id)) {
        return json({ error: '只有這趟行程的旅伴可以這樣做' }, 403);
      }
      const q = String(url.searchParams.get('q') || '').trim();
      if (!q) return json({ error: '請輸入地點' }, 400);
      if (q.length > 160) return json({ error: '查詢過長' }, 400);
      const key = serverMapsKey();
      if (!key) return json({ error: '伺服器未設定 Google 金鑰' }, 503);
      try {
        const place = await lookupPlace(q, key, { bias: 'circle:120000@43.4,142.0' });
        if (!place) return json({ error: '找不到地點' }, 404);
        return json({ name: place.name, address: place.address, lat: place.lat, lng: place.lng });
      } catch (e) {
        const detail = redactSecrets(e?.message || '');
        const error = placeFailureMessage(detail);
        console.warn('[places]', error, detail.slice(0, 180));
        return json({ error }, 502);
      }
    }

    if (method === 'GET' && pathname === '/api/opening-hours') {
      const auth = await this.bearerUser(request);
      if (auth.error) return auth.error;
      if (!this.tripState || !isTripMember(this.tripState, auth.user.id)) {
        return json({ error: '只有這趟行程的旅伴可以這樣做' }, 403);
      }
      const query = parseOpeningHoursQuery(url.searchParams);
      if (query.error) return json({ error: query.error }, query.status);
      // Free OpenStreetMap data only; Google's opening-hours fields are Enterprise-tier and never requested.
      return json({ hours: await this.osmOpeningHours(query), source: 'osm' });
    }

    return json({ error: 'Not found' }, 404);
  }

  /** Import / export with ADMIN_TOKEN. Off when the secret is unset or too short. */
  async admin(request, pathname) {
    const secret = this.env.ADMIN_TOKEN || '';
    const header = request.headers.get('authorization') || '';
    if (secret.length < 16) return json({ error: 'Not found' }, 404);
    if (header !== `Bearer ${secret}`) return json({ error: '未授權' }, 401);

    if (request.method === 'GET' && pathname === '/api/admin/export') {
      return json({ exportedAt: new Date().toISOString(), state: this.tripState, users: this.users.exportAll() });
    }

    if (request.method === 'POST' && pathname === '/api/admin/import') {
      const body = await this.readBody(request);
      if (this.tripState && this.source !== 'seed' && body.force !== true) {
        return json({ error: '已經有匯入的行程。確定要覆蓋請加上 force: true' }, 409);
      }
      let state;
      try {
        state = migrateSplitFields(body.state);
      } catch (err) {
        return json({ error: `state.json 格式不正確：${err.message}` }, 400);
      }
      const rows = Array.isArray(body.users) ? body.users : Array.isArray(body.users?.users) ? body.users.users : null;
      if (!rows) return json({ error: 'users.json 格式不正確' }, 400);
      const companionIds = (state.members || []).map((m) => m?.id).filter((id) => typeof id === 'string');
      const imported = await this.users.replaceAll(rows, companionIds);
      this.enrichGen++;
      this.tripState = state;
      this.source = 'import';
      saveDoc(this.sql, 'meta', { source: 'import' });
      this.fxBook = createFxBook(state.fx);
      this.tripState = { ...this.tripState, fx: this.fxBook.get() };
      this.saveState();
      for (const code of this.rooms()) this.broadcastTrip(code);
      return json({ ok: true, users: imported, stops: state.stops.length });
    }

    return json({ error: 'Not found' }, 404);
  }

  // ---------- WebSocket events ----------

  async webSocketMessage(ws, raw) {
    let msg;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    if (!msg || msg.t !== 'emit' || typeof msg.event !== 'string') return;
    let acked = false;
    const ack = (data) => {
      if (acked || typeof msg.ack !== 'number') return;
      acked = true;
      try {
        ws.send(JSON.stringify({ t: 'ack', id: msg.ack, data }));
      } catch {
        /* closed */
      }
    };
    const handler = this.handlers[msg.event];
    if (!handler) return;
    const payload = msg.data && typeof msg.data === 'object' ? msg.data : {};
    try {
      await handler.call(this, ws, payload, ack);
    } catch (err) {
      console.error(`[ws] ${msg.event}`, err?.stack || err);
      ack({ ok: false, error: '伺服器錯誤' });
    }
  }

  async webSocketClose(ws, code) {
    const { room } = this.meta(ws);
    if (room) this.emitPresence(room, ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'closing');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws) {
    const { room } = this.meta(ws);
    if (room) this.emitPresence(room, ws);
  }

  /** A Shortcut key (hks_...) on a WebSocket message: say so; never `session:required` (the client would log the user out). */
  refuseSavedKey(ws, ack) {
    this.send(ws, 'error:auth', { error: KEY_ONLY_FOR_SAVING });
    ack({ ok: false, error: KEY_ONLY_FOR_SAVING });
    return null;
  }

  async requireTripMember(ws, token, ack) {
    const parsed = await this.parseToken(token);
    if (parsed.status === 'saved-key') return this.refuseSavedKey(ws, ack);
    if (parsed.status === 'missing-account') {
      this.send(ws, 'session:required');
      const error = '登入已過期';
      this.send(ws, 'error:auth', { error });
      ack({ ok: false, error });
      return null;
    }
    if (parsed.status !== 'ok') {
      const error = '請先登入才能編輯';
      this.send(ws, 'error:auth', { error });
      ack({ ok: false, error });
      return null;
    }
    if (!this.tripState || !isTripMember(this.tripState, parsed.user.id)) {
      const error = '只有這趟行程的旅伴可以這樣做';
      this.send(ws, 'error:auth', { error });
      ack({ ok: false, error });
      return null;
    }
    return parsed.user;
  }

  editError(ws, ack, result) {
    this.send(ws, 'error:edit', { error: result.error });
    ack(result);
  }

  roomOf(ws) {
    return this.meta(ws).room || ROOM_CODE;
  }

  async beginAccountAdd(ws, token, username, ack) {
    const parsed = await this.parseToken(token);
    if (parsed.status === 'saved-key') return this.refuseSavedKey(ws, ack);
    if (parsed.status === 'missing-account') {
      this.send(ws, 'session:required');
      const error = '登入已過期';
      this.send(ws, 'error:auth', { error });
      ack({ ok: false, error });
      return null;
    }
    if (parsed.status !== 'ok') {
      const error = '請先登入才能編輯';
      this.send(ws, 'error:auth', { error });
      ack({ ok: false, error });
      return null;
    }
    if (!this.tripState) {
      ack({ ok: false, error: NOT_IMPORTED_ERROR });
      return null;
    }
    const requested = typeof username === 'string' ? username : '';
    if (!requested.trim()) {
      this.editError(ws, ack, { ok: false, error: '請輸入已註冊的帳號' });
      return null;
    }
    const account = this.users.findByUsername(requested);
    if (!account) {
      this.editError(ws, ack, { ok: false, error: '找不到這個帳號' });
      return null;
    }
    return { caller: parsed.user, requested, account };
  }

  finishMemberAdd(ws, requested, account, ack) {
    const roster = [{ id: account.id, username: account.username, displayName: account.displayName }];
    const result = addMember(this.tripState, { username: requested }, roster);
    if (!result.ok) return this.editError(ws, ack, result);
    this.tripState = result.state;
    this.saveBill(this.roomOf(ws));
    ack({ ok: true });
  }

  /** Apply a split.js result: on success save and ack, on failure report the error. */
  applyBill(ws, ack, result) {
    if (!result.ok) return this.editError(ws, ack, result);
    this.tripState = result.state;
    this.saveBill(this.roomOf(ws));
    ack({ ok: true });
  }

  handlers = {
    async 'room:join'(ws, { roomCode, token }, ack) {
      const prev = this.meta(ws).room;
      if (prev) {
        this.setMeta(ws, { room: null, presence: null });
        this.emitPresence(prev);
      }
      const parsed = await this.parseToken(token);
      if (parsed.status === 'saved-key') {
        this.refuseSavedKey(ws, ack);
        return;
      }
      if (parsed.status !== 'ok') {
        if (token) this.send(ws, 'session:required');
        ack({ ok: false, error: parsed.status === 'missing' ? '請先登入' : '登入已過期' });
        return;
      }
      if (!this.tripState) {
        ack({ ok: false, error: NOT_IMPORTED_ERROR });
        return;
      }
      const code = String(roomCode || ROOM_CODE).toUpperCase();
      if (!collaborativeTripReadable(this.tripState, parsed.user.id)) {
        this.send(ws, 'companion:required', { error: NOT_COMPANION_ERROR });
        ack({ ok: false, error: NOT_COMPANION_ERROR });
        return;
      }
      const user = parsed.user;
      const { sid } = this.meta(ws);
      this.setMeta(ws, {
        room: code,
        presence: {
          socketId: sid,
          userId: user.id,
          displayName: user.displayName || user.username || '旅伴',
          username: user.username || null,
        },
      });
      this.send(ws, 'trip:update', this.tripForClient());
      this.send(ws, 'fx:update', presentFx(this.tripState.fx));
      this.emitPresence(code);
      ack({ ok: true });
      await this.ensureFxAlarm();
    },

    async 'trip:reorder'(ws, { day, orderedIds, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      const ids = Array.isArray(orderedIds) ? orderedIds : [];
      const state = this.tripState;
      const dayStops = state.stops.filter((s) => s.day === day);
      const map = new Map(dayStops.map((s) => [s.id, s]));
      const reordered = ids.map((id) => map.get(id)).filter(Boolean);
      for (const s of dayStops) {
        if (!reordered.find((r) => r.id === s.id)) reordered.push(s);
      }
      const others = state.stops.filter((s) => s.day !== day);
      const all = [...others, ...reordered];
      const byDay = [];
      for (const d of state.days) byDay.push(...all.filter((s) => s.day === d.day));
      this.tripState = { ...state, stops: byDay, updatedAt: new Date().toISOString() };
      this.publish(this.roomOf(ws));
    },

    async 'trip:add'(ws, { stop, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      const input = stop && typeof stop === 'object' ? stop : {};
      const info = cleanStopInfo({ hours: input.hours, notes: input.notes });
      if (!info.ok) return this.editError(ws, ack, { ok: false, error: info.error });
      const state = this.tripState;
      const newStop = {
        id: `s${Date.now()}`,
        day: input.day,
        date: input.date || state.days.find((d) => d.day === input.day)?.date || '',
        title: input.title || '新站點',
        time: input.time || '',
        lat: Number(input.lat) || 43.06,
        lng: Number(input.lng) || 141.35,
        ...info.set,
      };
      const stops = [...state.stops];
      let insertAt = stops.length;
      for (let i = 0; i < stops.length; i++) {
        if (stops[i].day === newStop.day) insertAt = i + 1;
        else if (stops[i].day > newStop.day) {
          insertAt = i;
          break;
        }
      }
      stops.splice(insertAt, 0, newStop);
      this.tripState = { ...state, stops };
      this.publish(this.roomOf(ws));
    },

    async 'trip:updateStop'(ws, { id, patch, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      const result = applyStopPatch(this.tripState, id, patch);
      if (!result.ok) return this.editError(ws, ack, { ok: false, error: result.error || '無法更新站點' });
      if (result.unchanged) return ack({ ok: true, unchanged: true });
      this.tripState = result.state;
      this.publish(this.roomOf(ws), { enrich: !result.titleOnly });
      ack({ ok: true });
    },

    async 'trip:delete'(ws, { id, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      this.tripState = { ...this.tripState, stops: this.tripState.stops.filter((s) => s.id !== id) };
      this.publish(this.roomOf(ws));
    },

    async 'trip:setLegMode'(ws, { fromStopId, toStopId, mode, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      const next = setLegMode(this.tripState, fromStopId, toStopId, mode);
      if (!next.changed) return;
      this.tripState = next.state;
      this.publish(this.roomOf(ws));
    },

    async 'trip:setLodging'(ws, { lodging, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      const result = applyLodgingPatch(this.tripState, lodging);
      if (!result.ok) return this.editError(ws, ack, result);
      if (result.unchanged) return ack({ ok: true, unchanged: true });
      this.tripState = result.state;
      this.publish(this.roomOf(ws), { enrich: false });
      ack({ ok: true });
    },

    async 'trip:setDayLabel'(ws, { day, label, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      const result = applyDayLabel(this.tripState, { day, label });
      if (!result.ok) return this.editError(ws, ack, result);
      if (result.unchanged) return ack({ ok: true, unchanged: true, label: result.label });
      this.tripState = result.state;
      this.publish(this.roomOf(ws), { enrich: false });
      ack({ ok: true, label: result.label });
    },

    async 'trip:reset'(ws, { token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      if (this.production || this.source !== 'seed') {
        return this.editError(ws, ack, { ok: false, error: '這份行程是從已儲存的資料讀進來的，不會用種子覆蓋' });
      }
      const { members, expenses, settlements, fx } = this.tripState;
      this.tripState = { ...createSeedState(), members, expenses, settlements, fx };
      this.publish(this.roomOf(ws));
    },

    async 'expense:upsert'(ws, { expense, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      this.applyBill(ws, ack, upsertExpense(this.tripState, expense));
    },

    async 'expense:delete'(ws, { id, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      this.applyBill(ws, ack, deleteExpense(this.tripState, id));
    },

    async 'member:add'(ws, { username, token }, ack) {
      const ctx = await this.beginAccountAdd(ws, token, username, ack);
      if (!ctx) return;
      const allowed = memberAddAllowed(this.tripState, ctx.caller.id, ctx.account.id);
      if (!allowed.ok) {
        this.send(ws, 'error:auth', { error: allowed.error });
        return ack(allowed);
      }
      this.finishMemberAdd(ws, ctx.requested, ctx.account, ack);
    },

    async 'trip:addMember'(ws, { username, token }, ack) {
      const ctx = await this.beginAccountAdd(ws, token, username, ack);
      if (!ctx) return;
      const allowed = tripMemberAddAllowed(this.tripState, ctx.caller.id, ctx.account.id);
      if (!allowed.ok) {
        this.send(ws, 'error:auth', { error: allowed.error });
        return ack(allowed);
      }
      this.finishMemberAdd(ws, ctx.requested, ctx.account, ack);
    },

    async 'member:rename'(ws, _payload, ack) {
      this.editError(ws, ack, { ok: false, error: '旅伴就是登入帳號，不能另外取名' });
    },

    async 'member:remove'(ws, { id, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      this.applyBill(ws, ack, removeMember(this.tripState, id));
    },

    async 'settlement:add'(ws, { settlement, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      this.applyBill(ws, ack, addSettlement(this.tripState, settlement));
    },

    async 'settlement:delete'(ws, { id, token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      this.applyBill(ws, ack, deleteSettlement(this.tripState, id));
    },

    async 'fx:override'(ws, { basis, value, token }, ack) {
      const verified = await this.requireTripMember(ws, token, ack);
      if (!verified) return;
      const parsed = parseOverride({ basis, value });
      if (!parsed.ok) return this.editError(ws, ack, parsed);
      this.fxBook.setOverride({
        twdPerJpy: parsed.twdPerJpy,
        jpyPerTwd: parsed.jpyPerTwd,
        setAt: new Date().toISOString(),
        setBy: verified.displayName,
        setById: verified.id,
      });
      this.publishFx();
      ack({ ok: true, fx: presentFx(this.fxBook.get()) });
    },

    async 'fx:clearOverride'(ws, { token }, ack) {
      if (!(await this.requireTripMember(ws, token, ack))) return;
      this.fxBook.clearOverride();
      this.publishFx();
      ack({ ok: true, fx: presentFx(this.fxBook.get()) });
    },
  };
}
