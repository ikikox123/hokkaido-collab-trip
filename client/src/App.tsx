import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { FxView } from '../../server/src/fx.js';
import { LoginModal } from './components/LoginModal';
import { TripAlerts } from './components/TripAlerts';
import { TripList } from './components/TripList';
import { MapView } from './components/MapView';
import { PlaceStopDialog, type PickedPlace } from './components/PlaceStopDialog';
import { SplitBoard } from './components/SplitBoard';
import { clearAuth, getStoredUser, getToken } from './lib/auth';
import { usesGoogleMaps } from './lib/mapProvider';
import { isSplitPath, leaveSplit, openSplit } from './lib/splitLink';
import type { Leg, PresenceUser, Stop, TravelMode, TripState, User } from './types/trip';

type MobileTab = 'list' | 'map' | 'split';

function CurrentStopBar({ stop }: { stop: Stop | null }) {
  return (
    <div className="z-20 shrink-0 border-b border-ice-100 bg-white px-3 py-2">
      <div className="flex min-h-touch items-center gap-2">
        <span className="shrink-0 rounded-md bg-ice-600 px-2 py-1 text-sm font-bold text-white">目前站點</span>
        {stop ? (
          <p className="min-w-0 truncate text-base font-bold text-slate-900">
            <span className="mr-2 font-semibold text-ice-700">{stop.time || '時間未定'}</span>
            {stop.title}
          </p>
        ) : (
          <p className="truncate text-base text-slate-500">這天尚無站點</p>
        )}
      </div>
    </div>
  );
}

const DEFAULT_ROOM = 'HOKKAIDO2027';

export default function App() {
  const [trip, setTrip] = useState<TripState | null>(null);
  const [user, setUser] = useState<User | null>(() => getStoredUser());
  const [token, setToken] = useState<string | null>(() => getToken());
  const [roomCode, setRoomCode] = useState(DEFAULT_ROOM);
  const [online, setOnline] = useState<PresenceUser[]>([]);
  const [selectedDay, setSelectedDay] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [headerOpen, setHeaderOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState<MobileTab>(() => (isSplitPath(window.location.pathname) ? 'split' : 'list'));
  const [fx, setFx] = useState<FxView | null>(null);
  const [composeToken, setComposeToken] = useState(0);
  const pendingCompose = useRef(false);
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [placeDialog, setPlaceDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; stopId: string } | null
  >(null);
  const googlePlaces = usesGoogleMaps();

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const s = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('trip:update', (state: TripState) => {
      setTrip(state);
      if (state.fx) setFx(state.fx);
    });
    s.on('fx:update', (next: FxView) => {
      setFx(next);
    });
    s.on('presence:update', (p: { online: PresenceUser[]; count: number }) => {
      setOnline(p.online || []);
    });
    s.on('error:auth', (e: { error: string }) => {
      showToast(e.error || '需要登入');
    });
    s.on('error:edit', (e: { error: string }) => {
      showToast(e.error || '無法更新');
    });
    s.on('connect', () => {
      s.emit('room:join', {
        roomCode: roomCode || DEFAULT_ROOM,
        user: getStoredUser(),
      });
    });
    return () => {
      s.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // re-join when user / room changes
  useEffect(() => {
    if (!socket) return;
    socket.emit('room:join', { roomCode: roomCode || DEFAULT_ROOM, user });
  }, [socket, user, roomCode]);

  useEffect(() => {
    const onPop = () => setMobileTab(isSplitPath(window.location.pathname) ? 'split' : 'list');
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const pullFx = useCallback(async () => {
    try {
      const res = await fetch('/api/fx');
      if (!res.ok) return;
      setFx((await res.json()) as FxView);
    } catch {
      /* keep the last successful rate */
    }
  }, []);

  useEffect(() => {
    void pullFx();
    const id = window.setInterval(() => void pullFx(), 3 * 60 * 1000);
    return () => window.clearInterval(id);
  }, [pullFx]);

  useEffect(() => {
    if (mobileTab === 'split') void pullFx();
  }, [mobileTab, pullFx]);

  function selectTab(tab: MobileTab) {
    if (tab === 'split') openSplit();
    else if (isSplitPath(window.location.pathname)) leaveSplit();
    setMobileTab(tab);
  }

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const dayStops = useMemo(() => {
    if (!trip) return [];
    return trip.stops.filter((s) => s.day === selectedDay);
  }, [trip, selectedDay]);

  const dayLegs = useMemo(() => {
    const all = trip?.legs ?? [];
    const out: Leg[] = [];
    for (let i = 0; i < dayStops.length - 1; i++) {
      const from = dayStops[i];
      const to = dayStops[i + 1];
      const leg = all.find((l) => l.fromStopId === from.id && l.toStopId === to.id);
      if (leg) out.push(leg);
    }
    return out;
  }, [trip, dayStops]);

  const mapActive = isDesktop || mobileTab === 'map';
  const mobileSplit = !isDesktop && mobileTab === 'split';

  useEffect(() => {
    if (dayStops.length && !dayStops.find((s) => s.id === selectedId)) {
      setSelectedId(dayStops[0].id);
    }
    if (!dayStops.length) setSelectedId(null);
  }, [dayStops, selectedId]);

  const canEdit = Boolean(user && token);

  function handleLogin(u: User, t: string) {
    setUser(u);
    setToken(t);
    showToast(`歡迎，${u.displayName}`);
  }

  function handleLogout() {
    clearAuth();
    setUser(null);
    setToken(null);
    showToast('已登出');
  }

  function emitAuth(event: string, payload: Record<string, unknown>) {
    if (!socket) return;
    if (!token) {
      showToast('請先登入才能編輯');
      setLoginOpen(true);
      return;
    }
    socket.emit(event, { ...payload, token });
  }

  function joinRoom() {
    const code = (roomCode || DEFAULT_ROOM).toUpperCase();
    setRoomCode(code);
    socket?.emit('room:join', { roomCode: code, user });
    showToast(`已加入房間 ${code}`);
    setHeaderOpen(false);
  }

  if (!trip) {
    return (
      <div className="min-h-full flex items-center justify-center bg-snow-50 text-ice-700">
        <div className="text-center px-6">
          <div className="text-4xl mb-3">❄️</div>
          <p className="font-semibold">載入北海道行程中…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-snow-50 overflow-hidden pt-[var(--safe-top)]">
      {/* Top bar — compact on mobile, expandable */}
      <header className="shrink-0 bg-ice-700 text-white shadow-md z-20">
        <div className="flex items-center gap-2 px-3 min-h-touch py-2">
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-sm sm:text-base truncate leading-tight">
              {trip.tripName.split('｜')[0]}
            </h1>
            <p className="truncate text-sm text-white/80">
              {trip.tripName.includes('｜') ? trip.tripName.split('｜').slice(1).join('｜') : '多人協作'}
            </p>
          </div>
          <button
            type="button"
            className="min-h-touch min-w-touch rounded-lg bg-white/15 px-2 text-sm font-medium"
            onClick={() => setHeaderOpen((v) => !v)}
            aria-expanded={headerOpen}
          >
            {headerOpen ? '收合' : '選單'}
          </button>
          {user ? (
            <button
              type="button"
              className="min-h-touch px-3 rounded-lg bg-white/20 text-sm font-semibold"
              onClick={handleLogout}
            >
              {user.displayName}
            </button>
          ) : (
            <button
              type="button"
              className="min-h-touch px-3 rounded-lg bg-sakura-500 text-sm font-semibold"
              onClick={() => setLoginOpen(true)}
            >
              登入
            </button>
          )}
        </div>

        {headerOpen && (
          <div className="border-t border-white/15 px-3 py-3 space-y-3 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-white/80">房間碼</span>
              <input
                className="flex-1 min-w-[8rem] min-h-touch rounded-lg bg-white/10 border border-white/20 px-3 text-white placeholder:text-white/40"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder={DEFAULT_ROOM}
              />
              <button
                type="button"
                className="min-h-touch px-4 rounded-lg bg-white text-ice-700 font-semibold"
                onClick={joinRoom}
              >
                加入
              </button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/85">
              <span>線上 {online.length} 人</span>
              <span className="truncate max-w-full">
                {online.map((o) => o.displayName).join('、') || '尚無'}
              </span>
            </div>
            <div className="space-y-0.5 text-sm text-white/80">
              <div>住宿：{trip.lodging.name}</div>
              <div>去程 {trip.flights.outbound}</div>
              <div>回程 {trip.flights.inbound}</div>
            </div>
            {canEdit && (
              <button
                type="button"
                className="min-h-touch w-full rounded-lg border border-white/30 text-white/90"
                onClick={() => {
                  if (confirm('確定重置為種子行程？')) emitAuth('trip:reset', {});
                }}
              >
                重置種子資料
              </button>
            )}
          </div>
        )}
      </header>

      {/* Day strip stays outside the list scroller. Hidden on the phone bill tab. */}
      {!mobileSplit && (
      <nav aria-label="行程日期" className="z-20 shrink-0 border-b border-slate-200 bg-white">
        <div className="flex gap-1 overflow-x-auto no-scrollbar px-2 py-2">
          {trip.days.map((d) => (
            <button
              key={d.day}
              type="button"
              onClick={() => setSelectedDay(d.day)}
              className={`min-h-touch shrink-0 rounded-xl px-3 text-sm font-semibold transition ${
                selectedDay === d.day
                  ? 'bg-ice-600 text-white shadow'
                  : 'bg-snow-100 text-slate-600 active:bg-snow-200'
              }`}
            >
              <span className="block leading-tight">{d.label}</span>
              <span className="block text-sm font-medium opacity-90">{d.date.slice(5)}</span>
            </button>
          ))}
        </div>
      </nav>
      )}

      {!mobileSplit && <CurrentStopBar stop={dayStops.find((s) => s.id === selectedId) ?? null} />}

      {!mobileSplit && <TripAlerts />}

      {/* Main: stacked on mobile via tabs; side-by-side on md+ */}
      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section
          className={`min-h-0 flex-1 flex-col border-slate-200 bg-snow-50 md:w-[42%] md:max-w-md md:border-r ${
            mobileTab === 'map' ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="hidden shrink-0 grid-cols-2 gap-1 border-b border-slate-100 bg-white p-2 md:grid">
            <button
              type="button"
              className={`min-h-touch rounded-xl text-base font-bold ${
                mobileTab === 'split' ? 'bg-snow-100 text-slate-700' : 'bg-ice-600 text-white'
              }`}
              onClick={() => selectTab('list')}
            >
              行程
            </button>
            <button
              type="button"
              className={`min-h-touch rounded-xl text-base font-bold ${
                mobileTab === 'split' ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
              }`}
              onClick={() => selectTab('split')}
            >
              分帳
            </button>
          </div>
          <div className="min-h-0 flex-1">
          {mobileTab === 'split' ? (
            <SplitBoard
              trip={trip}
              canEdit={canEdit}
              userId={user?.id ?? null}
              username={user?.username ?? null}
              socket={socket}
              token={token}
              fx={fx}
              composeToken={composeToken}
              onNeedLogin={() => {
                pendingCompose.current = true;
                openSplit();
                setLoginOpen(true);
              }}
              onJumpToDay={(day, stopId) => {
                setSelectedDay(day);
                if (stopId) setSelectedId(stopId);
                selectTab('list');
              }}
            />
          ) : (
          <TripList
            stops={dayStops}
            legs={dayLegs}
            selectedId={selectedId}
            canEdit={canEdit}
            onSelect={(id) => {
              setSelectedId(id);
              if (window.matchMedia('(max-width: 767px)').matches) {
                setMobileTab('map');
              }
            }}
            onReorder={(orderedIds) => emitAuth('trip:reorder', { day: selectedDay, orderedIds })}
            onDelete={(id) => emitAuth('trip:delete', { id })}
            onSetMode={(fromStopId: string, toStopId: string, mode: TravelMode) =>
              emitAuth('trip:setLegMode', { fromStopId, toStopId, mode })
            }
            onAdd={() => {
              if (googlePlaces) {
                setPlaceDialog({ mode: 'add' });
                return;
              }
              const dayMeta = trip.days.find((d) => d.day === selectedDay);
              const title = prompt('新站點名稱？', '新景點');
              if (!title) return;
              emitAuth('trip:add', {
                stop: {
                  day: selectedDay,
                  date: dayMeta?.date,
                  title,
                  time: '12:00',
                  lat: dayStops[0]?.lat ?? trip.lodging.lat,
                  lng: dayStops[0]?.lng ?? trip.lodging.lng,
                  notes: '',
                },
              });
            }}
            onEditPlace={
              googlePlaces ? (id) => setPlaceDialog({ mode: 'edit', stopId: id }) : undefined
            }
            onUpdateTime={(id, time) => emitAuth('trip:updateStop', { id, patch: { time } })}
            onRename={(id, title) => emitAuth('trip:updateStop', { id, patch: { title } })}
          />
          )}
          </div>
        </section>

        <section
          className={`relative min-h-0 min-w-0 ${
            mobileTab === 'map'
              ? 'flex h-full min-h-0 flex-1 flex-col'
              : 'hidden md:flex md:h-full md:min-h-0 md:flex-1 md:flex-col'
          }`}
        >
          <MapView
            stops={dayStops}
            legs={dayLegs}
            selectedId={selectedId}
            active={mapActive}
            lodging={trip.lodging}
            canEdit={canEdit}
            onSelect={setSelectedId}
            onRename={(id, title) => emitAuth('trip:updateStop', { id, patch: { title } })}
          />
        </section>
      </main>

      <nav
        aria-label="切換行程、分帳與地圖"
        className="grid shrink-0 grid-cols-3 gap-2 border-t border-slate-200 bg-white px-3 pt-2 md:hidden"
        style={{ paddingBottom: 'max(0.5rem, var(--safe-bottom))' }}
      >
        {(
          [
            ['list', '行程'],
            ['split', '分帳'],
            ['map', '地圖'],
          ] as [MobileTab, string][]
        ).map(([tab, label]) => (
          <button
            key={tab}
            type="button"
            aria-current={mobileTab === tab ? 'page' : undefined}
            className={`min-h-touch min-w-0 rounded-xl px-1 text-base font-bold ${
              mobileTab === tab ? 'bg-ice-600 text-white shadow' : 'bg-snow-100 text-slate-700'
            }`}
            onClick={() => selectTab(tab)}
          >
            {label}
          </button>
        ))}
      </nav>

      <LoginModal
        open={loginOpen}
        onClose={() => {
          pendingCompose.current = false;
          setLoginOpen(false);
        }}
        onLogin={(nextUser, nextToken) => {
          const openForm = pendingCompose.current;
          pendingCompose.current = false;
          handleLogin(nextUser, nextToken);
          if (openForm) {
            openSplit();
            setMobileTab('split');
            setComposeToken((current) => current + 1);
          }
        }}
      />

      <PlaceStopDialog
        open={Boolean(placeDialog)}
        mode={placeDialog?.mode ?? 'add'}
        initialTitle={
          placeDialog?.mode === 'edit'
            ? trip.stops.find((s) => s.id === placeDialog.stopId)?.title || ''
            : ''
        }
        token={token}
        onClose={() => setPlaceDialog(null)}
        onConfirm={(place: PickedPlace) => {
          if (!placeDialog) return;
          if (placeDialog.mode === 'edit') {
            emitAuth('trip:updateStop', {
              id: placeDialog.stopId,
              patch: {
                title: place.title,
                lat: place.lat,
                lng: place.lng,
                ...(place.address ? { notes: place.address } : {}),
              },
            });
          } else {
            const dayMeta = trip.days.find((d) => d.day === selectedDay);
            emitAuth('trip:add', {
              stop: {
                day: selectedDay,
                date: dayMeta?.date,
                title: place.title,
                time: '12:00',
                lat: place.lat,
                lng: place.lng,
                notes: place.address,
              },
            });
          }
          setPlaceDialog(null);
        }}
      />

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1rem+var(--safe-bottom))] z-[60] rounded-full bg-slate-900/90 text-white text-sm px-4 py-2.5 shadow-lg max-w-[90vw]">
          {toast}
        </div>
      )}
    </div>
  );
}
