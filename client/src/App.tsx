import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import type { FxView } from '../../server/src/fx.js';
import { LoginModal } from './components/LoginModal';
import { TripAlerts } from './components/TripAlerts';
import { TripList } from './components/TripList';
import { MapView } from './components/MapView';
import { LodgingDialog, type LodgingDraft } from './components/LodgingDialog';
import { PlaceStopDialog, type PickedPlace } from './components/PlaceStopDialog';
import { SplitBoard } from './components/SplitBoard';
import { LanguageMenu } from './i18n/LanguageMenu';
import { useI18n } from './i18n/I18nProvider';
import { displayDayLabel, pageHeading } from './i18n/screen.ts';
import { displayStopTitle } from './i18n/stopNames';
import { localizeError } from './i18n/errors';
import { ShareMenu } from './components/ShareMenu';
import { clearAuth, getStoredUser, getToken } from './lib/auth';
import { emitAck } from './lib/bill';
import { SAPPORO_BASE } from './lib/dayView';
import { usesGoogleMaps } from './lib/mapProvider';
import { shareLocation } from './lib/sharePath';
import { isSplitPath, leaveSplit, openSplit } from './lib/splitLink';
import type { Leg, PresenceUser, Stop, TravelMode, TripState, User } from './types/trip';

type MobileTab = 'list' | 'map' | 'split';

function CurrentStopBar({ stop }: { stop: Stop | null }) {
  const { t, locale } = useI18n();
  return (
    <div className="z-20 shrink-0 border-b border-ice-100 bg-white px-3 py-2">
      <div className="flex min-h-touch items-center gap-2">
        <span className="shrink-0 rounded-md bg-ice-600 px-2 py-1 text-sm font-bold text-white">{t('currentStop')}</span>
        {stop ? (
          <p className="min-w-0 truncate text-base font-bold text-slate-900">
            <span className="mr-2 font-semibold text-ice-700">{stop.time || t('timeUnset')}</span>
            {displayStopTitle(locale, stop.title)}
          </p>
        ) : (
          <p className="truncate text-base text-slate-500">{t('noStopsToday')}</p>
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
  const [notCompanion, setNotCompanion] = useState(false);
  const [placeDialog, setPlaceDialog] = useState<
    { mode: 'add' } | { mode: 'edit'; stopId: string } | null
  >(null);
  const [lodgingOpen, setLodgingOpen] = useState(false);
  const googlePlaces = usesGoogleMaps();
  const { locale, t } = useI18n();
  const tRef = useRef(t);
  tRef.current = t;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    const s = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    setSocket(s);
    s.on('trip:update', (state: TripState) => {
      setNotCompanion(false);
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
      const translate = tRef.current;
      showToast(localizeError(e.error || translate('needLogin'), translate));
    });
    s.on('error:edit', (e: { error: string }) => {
      const translate = tRef.current;
      showToast(localizeError(e.error || translate('cannotUpdate'), translate));
    });
    s.on('companion:required', () => {
      setNotCompanion(true);
      setTrip(null);
      setOnline([]);
    });
    s.on('session:required', () => {
      clearAuth();
      setNotCompanion(false);
      setUser(null);
      setToken(null);
      setTrip(null);
      showToast(tRef.current('sessionExpired'));
    });
    s.on('connect', () => {
      s.emit('room:join', {
        roomCode: roomCode || DEFAULT_ROOM,
        token: getToken(),
      });
    });
    return () => {
      s.disconnect();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // re-join when user / room changes
  useEffect(() => {
    if (!socket) return;
    socket.emit('room:join', { roomCode: roomCode || DEFAULT_ROOM, token });
  }, [socket, token, roomCode]);

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
  const isTripCompanion = Boolean(user?.id && trip?.members?.some((member) => member.id === user.id));

  function handleLogin(u: User, nextToken: string) {
    setNotCompanion(false);
    setUser(u);
    setToken(nextToken);
    showToast(t('welcome', { name: u.displayName }));
  }

  function handleLogout() {
    clearAuth();
    setNotCompanion(false);
    setUser(null);
    setToken(null);
    setTrip(null);
    showToast(t('loggedOut'));
  }

  function emitAuth(event: string, payload: Record<string, unknown>) {
    if (!socket) return;
    if (!token) {
      showToast(t('loginToEdit'));
      setLoginOpen(true);
      return;
    }
    socket.emit(event, { ...payload, token });
  }

  function joinRoom() {
    const code = (roomCode || DEFAULT_ROOM).toUpperCase();
    setRoomCode(code);
    socket?.emit('room:join', { roomCode: code, token });
    showToast(t('joinedRoom', { code }));
    setHeaderOpen(false);
  }

  const toastNode = toast ? (
    <div className="fixed left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2.5 text-sm text-white shadow-lg bottom-[calc(1rem+var(--safe-bottom))]">
      {toast}
    </div>
  ) : null;

  if (!user || !token) {
    return (
      <div className="min-h-full bg-snow-50 text-slate-800">
        <header className="bg-ice-700 px-3 py-3 pt-[max(0.75rem,var(--safe-top))] text-white">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-base font-bold">{pageHeading(locale)}</h1>
            <ShareMenu scope={{ kind: 'all' }} lang={locale} />
            <LanguageMenu />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
          <p className="text-sm leading-relaxed text-slate-600">{t('collabNeedsLogin')}</p>
          <a
            href={shareLocation({ kind: 'all' }, locale)}
            className="flex min-h-touch items-center justify-center rounded-xl border border-ice-200 bg-white px-3 text-base font-bold text-ice-700"
          >
            {t('shareOpen')}
          </a>
          <LoginModal embedded open onClose={() => {}} onLogin={handleLogin} />
        </main>
        {toastNode}
      </div>
    );
  }

  if (notCompanion) {
    return (
      <div className="min-h-full bg-snow-50 text-slate-800">
        <header className="bg-ice-700 px-3 py-3 pt-[max(0.75rem,var(--safe-top))] text-white">
          <div className="flex items-center gap-2">
            <h1 className="min-w-0 flex-1 truncate text-base font-bold">{pageHeading(locale)}</h1>
            <LanguageMenu />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
          <p className="text-sm leading-relaxed text-slate-600">{t('notCompanionYet')}</p>
          <a
            href={shareLocation({ kind: 'all' }, locale)}
            className="flex min-h-touch items-center justify-center rounded-xl border border-ice-200 bg-white px-3 text-base font-bold text-ice-700"
          >
            {t('shareOpen')}
          </a>
          <button
            type="button"
            className="flex min-h-touch items-center justify-center rounded-xl bg-ice-600 px-3 text-base font-bold text-white"
            onClick={handleLogout}
          >
            {t('logOut')}
          </button>
        </main>
        {toastNode}
      </div>
    );
  }

  if (!trip) {
    return (
      <div className="relative min-h-full flex items-center justify-center bg-snow-50 text-ice-700">
        <div className="absolute right-3 top-[max(0.75rem,var(--safe-top))] flex items-center gap-2">
          <ShareMenu scope={{ kind: 'day', day: selectedDay }} lang={locale} tone="light" />
          <LanguageMenu tone="light" />
        </div>
        <div className="text-center px-6">
          <div className="text-4xl mb-3">❄️</div>
          <p className="font-semibold">{t('loadingTrip')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-snow-50 overflow-hidden pt-[var(--safe-top)]">
      {/* Top bar — compact on mobile, expandable */}
      <header className="shrink-0 bg-ice-700 text-white shadow-md z-20">
        <div className="flex items-center gap-1 px-2 min-h-touch py-2 sm:gap-2 sm:px-3">
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-sm sm:text-base truncate leading-tight">
              {pageHeading(locale)}
            </h1>
            <p className="truncate text-sm text-white/80">
              {trip.tripName.includes('｜') ? trip.tripName.split('｜').slice(1).join('｜') : t('collabFallback')}
            </p>
          </div>
          <ShareMenu scope={{ kind: 'day', day: selectedDay }} lang={locale} />
          <LanguageMenu />
          <button
            type="button"
            className="min-h-touch min-w-touch rounded-lg bg-white/15 px-2 text-sm font-medium"
            onClick={() => setHeaderOpen((v) => !v)}
            aria-expanded={headerOpen}
          >
            {headerOpen ? t('collapse') : t('menu')}
          </button>
          {user ? (
            <button
              type="button"
              className="min-h-touch min-w-0 max-w-[3.5rem] truncate rounded-lg bg-white/20 px-2 text-sm font-semibold sm:max-w-[9rem] sm:px-3"
              title={user.displayName}
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
              {t('login')}
            </button>
          )}
        </div>

        {headerOpen && (
          <div className="border-t border-white/15 px-3 py-3 space-y-3 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-white/80">{t('roomCode')}</span>
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
                {t('join')}
              </button>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/85">
              <span>{t('onlineCount', { count: online.length })}</span>
              <span className="truncate max-w-full">
                {online.map((o) => o.displayName).join(t('listSep')) || t('noneYet')}
              </span>
            </div>
            <div className="space-y-0.5 text-sm text-white/80">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 truncate">
                  {t('lodgingLine', { name: trip.lodging?.name?.trim() || t('lodgingUnset') })}
                </div>
                {canEdit && isTripCompanion && (
                  <button
                    type="button"
                    className="min-h-touch shrink-0 rounded-lg bg-white/15 px-3 text-sm font-semibold text-white"
                    onClick={() => setLodgingOpen(true)}
                  >
                    {t('editLodging')}
                  </button>
                )}
              </div>
              <div>{t('outboundLine', { text: trip.flights.outbound })}</div>
              <div>{t('inboundLine', { text: trip.flights.inbound })}</div>
            </div>
            <a
              href="/share"
              className="flex min-h-touch items-center justify-center rounded-lg border border-white/30 px-3 font-semibold text-white/90"
            >
              {t('shareOpen')}
            </a>
            {isTripCompanion && (
              <button
                type="button"
                className="min-h-touch w-full rounded-lg border border-white/30 text-white/90"
                onClick={() => {
                  if (confirm(t('resetConfirm'))) emitAuth('trip:reset', {});
                }}
              >
                {t('resetSeed')}
              </button>
            )}
          </div>
        )}
      </header>

      {/* Day strip stays outside the list scroller. Hidden on the phone bill tab. */}
      {!mobileSplit && (
      <nav aria-label={t('dayNav')} className="z-20 shrink-0 border-b border-slate-200 bg-white">
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
              <span className="block leading-tight">{displayDayLabel(locale, d.label)}</span>
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
              {t('tabItinerary')}
            </button>
            <button
              type="button"
              className={`min-h-touch rounded-xl text-base font-bold ${
                mobileTab === 'split' ? 'bg-ice-600 text-white' : 'bg-snow-100 text-slate-700'
              }`}
              onClick={() => selectTab('split')}
            >
              {t('tabSplit')}
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
            canEdit={isTripCompanion}
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
              const title = prompt(t('newStopPrompt'), t('newStopDefault'));
              if (!title) return;
              emitAuth('trip:add', {
                stop: {
                  day: selectedDay,
                  date: dayMeta?.date,
                  title,
                  time: '12:00',
                  lat: dayStops[0]?.lat ?? trip.lodging?.lat ?? SAPPORO_BASE.lat,
                  lng: dayStops[0]?.lng ?? trip.lodging?.lng ?? SAPPORO_BASE.lng,
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
            canEdit={isTripCompanion}
            onSelect={setSelectedId}
            onRename={(id, title) => emitAuth('trip:updateStop', { id, patch: { title } })}
          />
        </section>
      </main>

      <nav
        aria-label={t('tabNav')}
        className="grid shrink-0 grid-cols-3 gap-2 border-t border-slate-200 bg-white px-3 pt-2 md:hidden"
        style={{ paddingBottom: 'max(0.5rem, var(--safe-bottom))' }}
      >
        {(
          [
            ['list', t('tabItinerary')],
            ['split', t('tabSplit')],
            ['map', t('tabMap')],
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

      <LodgingDialog
        open={lodgingOpen}
        lodging={trip.lodging}
        stops={trip.stops}
        token={token}
        onClose={() => setLodgingOpen(false)}
        onSave={async (lodging: LodgingDraft) => {
          if (!socket || !token) {
            showToast(t('loginToEdit'));
            setLoginOpen(true);
            return { ok: false, error: '請先登入才能編輯' };
          }
          const result = await emitAck(socket, 'trip:setLodging', { lodging, token });
          if (!result.ok) return result;
          showToast(t('lodgingSaved'));
          setLodgingOpen(false);
          return result;
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

      {toastNode}
    </div>
  );
}
