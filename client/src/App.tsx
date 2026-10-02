import { useCallback, useEffect, useMemo, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { WeatherBar } from './components/WeatherBar';
import { LoginModal } from './components/LoginModal';
import { TripList } from './components/TripList';
import { MapView } from './components/MapView';
import { clearAuth, getStoredUser, getToken } from './lib/auth';
import type { Leg, PresenceUser, TravelMode, TripState, User } from './types/trip';

type MobileTab = 'list' | 'map';

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
  const [mobileTab, setMobileTab] = useState<MobileTab>('list');
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches,
  );
  const [socket, setSocket] = useState<Socket | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const s = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('trip:update', (state: TripState) => {
      setTrip(state);
    });
    s.on('presence:update', (p: { online: PresenceUser[]; count: number }) => {
      setOnline(p.online || []);
    });
    s.on('error:auth', (e: { error: string }) => {
      showToast(e.error || '需要登入');
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
            <p className="text-[11px] text-white/75 truncate">
              {trip.tripName.includes('｜') ? trip.tripName.split('｜').slice(1).join('｜') : '多人協作'}
            </p>
          </div>
          <button
            type="button"
            className="min-h-touch min-w-touch rounded-lg bg-white/15 px-2 text-xs font-medium"
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
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-white/85 text-xs">
              <span>線上 {online.length} 人</span>
              <span className="truncate max-w-full">
                {online.map((o) => o.displayName).join('、') || '尚無'}
              </span>
            </div>
            <div className="text-white/70 text-xs space-y-0.5">
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
        <WeatherBar />
      </header>

      {/* Day tabs — horizontal scroll */}
      <nav className="shrink-0 bg-white border-b border-slate-200 z-10">
        <div className="flex overflow-x-auto no-scrollbar gap-1 px-2 py-2">
          {trip.days.map((d) => (
            <button
              key={d.day}
              type="button"
              onClick={() => setSelectedDay(d.day)}
              className={`shrink-0 min-h-touch px-3 rounded-xl text-sm font-semibold transition ${
                selectedDay === d.day
                  ? 'bg-ice-600 text-white shadow'
                  : 'bg-snow-100 text-slate-600 active:bg-snow-200'
              }`}
            >
              <span className="block leading-tight">{d.label}</span>
              <span className="block text-[10px] font-normal opacity-80">{d.date.slice(5)}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Mobile tab switcher */}
      <div className="md:hidden shrink-0 flex bg-white border-b border-slate-100 px-2 py-1 gap-1">
        <button
          type="button"
          className={`flex-1 min-h-touch rounded-xl text-sm font-semibold ${
            mobileTab === 'list' ? 'bg-ice-600 text-white' : 'text-slate-600'
          }`}
          onClick={() => setMobileTab('list')}
        >
          列表
        </button>
        <button
          type="button"
          className={`flex-1 min-h-touch rounded-xl text-sm font-semibold ${
            mobileTab === 'map' ? 'bg-ice-600 text-white' : 'text-slate-600'
          }`}
          onClick={() => setMobileTab('map')}
        >
          地圖
        </button>
      </div>

      {/* Main: stacked on mobile via tabs; side-by-side on md+ */}
      <main className="flex-1 min-h-0 flex flex-col md:flex-row">
        <section
          className={`flex-1 min-h-0 md:w-[42%] md:max-w-md md:border-r border-slate-200 bg-snow-50 ${
            mobileTab === 'list' ? 'flex flex-col' : 'hidden md:flex md:flex-col'
          }`}
        >
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
            onUpdateTime={(id, time) => emitAuth('trip:updateStop', { id, patch: { time } })}
          />
        </section>

        <section
          className={`relative min-h-0 min-w-0 ${
            mobileTab === 'map'
              ? 'flex h-full min-h-[55dvh] flex-1 flex-col'
              : 'hidden md:flex md:h-full md:min-h-0 md:flex-1 md:flex-col'
          }`}
        >
          <MapView
            stops={dayStops}
            legs={dayLegs}
            selectedId={selectedId}
            active={mapActive}
            lodging={trip.lodging}
            onSelect={setSelectedId}
          />
        </section>
      </main>

      {/* Safe-area spacer for home indicator when on list */}
      <div className="h-[var(--safe-bottom)] bg-white shrink-0 md:hidden" />

      <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} onLogin={handleLogin} />

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-[calc(1rem+var(--safe-bottom))] z-[60] rounded-full bg-slate-900/90 text-white text-sm px-4 py-2.5 shadow-lg max-w-[90vw]">
          {toast}
        </div>
      )}
    </div>
  );
}
