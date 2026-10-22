import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { connectRealtime, type RealtimeSocket } from './lib/realtime';
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
import { DayScene, FlightCard, Mascot, Snowfall } from './components/Cute';
import { DayTimeline } from './components/DayTimeline';
import { clearAuth, getStoredUser, getToken } from './lib/auth';
import { emitAck } from './lib/bill';
import { SAPPORO_BASE } from './lib/dayView';
import { usesGoogleMaps } from './lib/mapProvider';
import { openShareExport } from './lib/shareExport';
import { shareLocation } from './lib/sharePath';
import { isSplitPath, leaveSplit, openSplit } from './lib/splitLink';
import type { Leg, PresenceUser, Stop, TravelMode, TripState, User } from './types/trip';

type MobileTab = 'list' | 'map' | 'split';

function CurrentStopBar({
  stop,
  day,
  dayLabel,
  lodgingName,
}: {
  stop: Stop | null;
  day: number;
  dayLabel: string;
  lodgingName: string;
}) {
  const { t, locale } = useI18n();
  return (
    <div className="z-20 shrink-0 bg-snow-50 px-3 py-2">
      <div
        key={`${day}-${stop?.id ?? 'none'}`}
        className="cute-enter cute-pop flex min-h-touch items-center gap-3 rounded-2xl border-2 border-ink bg-sakura-100 p-2 shadow-sticker"
      >
        <DayScene day={day} className="h-12 w-[4.25rem] shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <span className="truncate">{dayLabel}</span>
            <span className="shrink-0 rounded-full border-[1.5px] border-ink bg-white px-1.5 text-[11px] font-bold leading-4 text-ink">
              {t('currentStop')}
            </span>
          </p>
          {stop ? (
            <p className="truncate text-base font-bold leading-snug text-ink">
              <span className="mr-1.5 text-ice-600">{stop.time || t('timeUnset')}</span>
              {displayStopTitle(locale, stop.title)}
            </p>
          ) : (
            <p className="truncate text-base font-semibold text-slate-500">{t('noStopsToday')}</p>
          )}
          <p className="truncate text-xs text-slate-500">{t('lodgingLine', { name: lodgingName })}</p>
        </div>
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
  const [socket, setSocket] = useState<RealtimeSocket | null>(null);
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
    const s = connectRealtime();
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
    <div className="cute-enter fixed left-1/2 z-[60] max-w-[90vw] -translate-x-1/2 rounded-full border-2 border-ink bg-butter-100 px-4 py-2.5 text-sm font-bold text-ink shadow-sticker bottom-[calc(5rem+var(--safe-bottom))] md:bottom-[calc(1rem+var(--safe-bottom))]">
      {toast}
    </div>
  ) : null;

  if (!user || !token) {
    return (
      <div className="cute-paper min-h-full text-ink">
        <header className="relative overflow-hidden border-b-2 border-ink bg-snow-50 px-3 py-3 pt-[max(0.75rem,var(--safe-top))] text-ink">
          <Snowfall />
          <div className="relative flex items-center gap-2">
            <span className="mascot-bob shrink-0">
              <Mascot size={36} />
            </span>
            <h1 className="min-w-0 flex-1 truncate text-base font-bold">{pageHeading(locale)}</h1>
            <ShareMenu scope={{ kind: 'all' }} lang={locale} />
            <LanguageMenu />
          </div>
        </header>
        <main className="cute-enter mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
          <p className="text-sm leading-relaxed text-slate-600">{t('collabNeedsLogin')}</p>
          <a
            href={shareLocation({ kind: 'all' }, locale)}
            className="cute-pop flex min-h-touch items-center justify-center rounded-full border-2 border-ink bg-mint-200 px-3 text-base font-bold text-ink shadow-sticker"
          >
            {t('shareOpen')}
          </a>
          <p className="text-sm leading-relaxed text-slate-600">{t('shareCanExport')}</p>
          <LoginModal embedded open onClose={() => {}} onLogin={handleLogin} />
        </main>
        {toastNode}
      </div>
    );
  }

  if (notCompanion) {
    return (
      <div className="cute-paper min-h-full text-ink">
        <header className="relative overflow-hidden border-b-2 border-ink bg-snow-50 px-3 py-3 pt-[max(0.75rem,var(--safe-top))] text-ink">
          <Snowfall />
          <div className="relative flex items-center gap-2">
            <span className="mascot-bob shrink-0">
              <Mascot size={36} />
            </span>
            <h1 className="min-w-0 flex-1 truncate text-base font-bold">{pageHeading(locale)}</h1>
            <LanguageMenu />
          </div>
        </header>
        <main className="cute-enter mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
          <p className="text-sm leading-relaxed text-slate-600">{t('notCompanionYet')}</p>
          <a
            href={shareLocation({ kind: 'all' }, locale)}
            className="cute-pop flex min-h-touch items-center justify-center rounded-full border-2 border-ink bg-mint-200 px-3 text-base font-bold text-ink shadow-sticker"
          >
            {t('shareOpen')}
          </a>
          <p className="text-sm leading-relaxed text-slate-600">{t('shareCanExport')}</p>
          <button
            type="button"
            className="cute-pop flex min-h-touch items-center justify-center rounded-full border-2 border-ink bg-sakura-500 px-3 text-base font-bold text-ink shadow-sticker"
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
      <div className="cute-paper relative min-h-full flex items-center justify-center text-ink">
        <div className="absolute right-3 top-[max(0.75rem,var(--safe-top))] flex items-center gap-2">
          <ShareMenu scope={{ kind: 'day', day: selectedDay }} lang={locale} tone="light" />
          <LanguageMenu tone="light" />
        </div>
        <div className="text-center px-6">
          <div className="mascot-hop mb-3 flex justify-center">
            <Mascot size={72} />
          </div>
          <p className="font-semibold">{t('loadingTrip')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col bg-snow-50 text-ink overflow-hidden pt-[var(--safe-top)]">
      {/* Top bar — compact on mobile, expandable */}
      <header className="relative shrink-0 overflow-hidden border-b-2 border-ink bg-snow-50 text-ink z-20">
        <Snowfall />
        <div className="relative flex items-center gap-1 px-1.5 min-h-touch py-2 sm:gap-2 sm:px-3">
          <span className="mascot-bob hidden shrink-0 min-[400px]:block sm:block">
            <Mascot size={34} />
          </span>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-sm sm:text-base truncate leading-tight">
              {pageHeading(locale)}
            </h1>
            <p className="truncate text-sm text-slate-600">
              {trip.tripName.includes('｜') ? trip.tripName.split('｜').slice(1).join('｜') : t('collabFallback')}
            </p>
          </div>
          <ShareMenu scope={{ kind: 'day', day: selectedDay }} lang={locale} />
          <LanguageMenu />
          <button
            type="button"
            className={`cute-press min-h-touch shrink-0 rounded-full border-2 border-ink px-2 text-sm font-bold sm:px-3 ${
              headerOpen ? 'bg-sakura-500' : 'bg-mint-200'
            }`}
            onClick={() => setHeaderOpen((v) => !v)}
            aria-expanded={headerOpen}
          >
            {headerOpen ? t('collapse') : t('menu')}
          </button>
          {user ? (
            <button
              type="button"
              className="cute-press min-h-touch min-w-0 max-w-[2.6rem] truncate rounded-full border-2 border-ink bg-butter-100 px-1.5 text-sm font-bold min-[360px]:max-w-[3.5rem] sm:max-w-[9rem] sm:px-3"
              title={user.displayName}
              onClick={handleLogout}
            >
              {user.displayName}
            </button>
          ) : (
            <button
              type="button"
              className="cute-press min-h-touch px-3 rounded-full border-2 border-ink bg-sakura-500 text-sm font-bold"
              onClick={() => setLoginOpen(true)}
            >
              {t('login')}
            </button>
          )}
        </div>

        {headerOpen && (
          <div className="cute-enter relative max-h-[70dvh] overflow-y-auto border-t-2 border-dashed border-ink/40 px-3 py-3 space-y-3 text-sm">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="font-bold">{t('roomCode')}</span>
              <input
                className="flex-1 min-w-[8rem] min-h-touch rounded-lg border border-ink bg-white px-3 font-bold tracking-wider text-ink placeholder:text-slate-400"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                placeholder={DEFAULT_ROOM}
              />
              <button
                type="button"
                className="cute-pop min-h-touch px-4 rounded-full border-2 border-ink bg-sakura-500 text-ink font-bold shadow-sticker-sm"
                onClick={joinRoom}
              >
                {t('join')}
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
              <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-mint-100 px-2 font-bold text-ink">
                <span className="h-2 w-2 rounded-full bg-mint-500" aria-hidden />
                {t('onlineCount', { count: online.length })}
              </span>
              <span className="truncate max-w-full">
                {online.map((o) => o.displayName).join(t('listSep')) || t('noneYet')}
              </span>
            </div>
            <div className="space-y-2 text-sm text-slate-700">
              <div className="flex items-center gap-2 rounded-2xl border-2 border-ink bg-white px-3 py-1">
                <div className="min-w-0 flex-1 truncate font-semibold text-ink">
                  {t('lodgingLine', { name: trip.lodging?.name?.trim() || t('lodgingUnset') })}
                </div>
                {canEdit && isTripCompanion && (
                  <button
                    type="button"
                    className="cute-press min-h-touch shrink-0 rounded-full border-2 border-ink bg-mint-200 px-3 text-sm font-bold text-ink"
                    onClick={() => setLodgingOpen(true)}
                  >
                    {t('editLodging')}
                  </button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <FlightCard title={t('outboundLine', { text: '' }).trim()} text={trip.flights.outbound} />
                <FlightCard title={t('inboundLine', { text: '' }).trim()} text={trip.flights.inbound} />
              </div>
            </div>
            <a
              href={shareLocation({ kind: 'day', day: selectedDay }, locale)}
              className="cute-pop flex min-h-touch items-center justify-center rounded-full border-2 border-ink bg-white px-3 font-bold text-ink shadow-sticker-sm"
            >
              {t('shareOpen')}
            </a>
            <button
              type="button"
              className="cute-pop flex min-h-touch w-full items-center justify-center rounded-full border-2 border-ink bg-white px-3 font-bold text-ink shadow-sticker-sm"
              onClick={() => openShareExport('image', { kind: 'day', day: selectedDay }, locale)}
            >
              {t('shareExportImage')}
            </button>
            <button
              type="button"
              className="cute-pop flex min-h-touch w-full items-center justify-center rounded-full border-2 border-ink bg-white px-3 font-bold text-ink shadow-sticker-sm"
              onClick={() => openShareExport('pdf', { kind: 'day', day: selectedDay }, locale)}
            >
              {t('shareExportPdf')}
            </button>
            {isTripCompanion && (
              <button
                type="button"
                className="cute-pop min-h-touch w-full rounded-full border-2 border-dashed border-ink/60 font-semibold text-slate-600"
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
      {!mobileSplit && <DayTimeline days={trip.days} selectedDay={selectedDay} onSelect={setSelectedDay} />}

      {!mobileSplit && (
        <CurrentStopBar
          stop={dayStops.find((s) => s.id === selectedId) ?? null}
          day={selectedDay}
          dayLabel={displayDayLabel(locale, trip.days.find((d) => d.day === selectedDay)?.label ?? `D${selectedDay}`)}
          lodgingName={trip.lodging?.name?.trim() || t('lodgingUnset')}
        />
      )}

      {!mobileSplit && <TripAlerts />}

      {/* Main: stacked on mobile via tabs; side-by-side on md+ */}
      <main className="flex min-h-0 flex-1 flex-col md:flex-row">
        <section
          className={`cute-paper min-h-0 flex-1 flex-col border-ink md:w-[42%] md:max-w-md md:border-r-2 ${
            mobileTab === 'map' ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="hidden shrink-0 border-b-2 border-ink bg-snow-50 p-2 md:block">
            <div
              className="relative grid grid-cols-2 gap-1 rounded-full border-2 border-ink bg-white p-1"
              style={{ '--tab-count': 2, '--tab-index': mobileTab === 'split' ? 1 : 0, '--tab-gap': '0.25rem' } as CSSProperties}
            >
              <span className="pointer-events-none absolute inset-1" aria-hidden>
                <span className="tab-slider rounded-full border-2 border-ink bg-sakura-500" />
              </span>
              {(
                [
                  ['list', t('tabItinerary')],
                  ['split', t('tabSplit')],
                ] as [MobileTab, string][]
              ).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={(tab === 'split') === (mobileTab === 'split')}
                  className="cute-press relative min-h-[40px] rounded-full text-base font-bold text-ink"
                  onClick={() => selectTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
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
        className="shrink-0 border-t-2 border-ink bg-snow-50 px-3 pt-2 md:hidden"
        style={{ paddingBottom: 'max(0.5rem, var(--safe-bottom))' }}
      >
        <div
          className="relative grid grid-cols-3 gap-1 rounded-full border-2 border-ink bg-white p-1 shadow-sticker-sm"
          style={
            {
              '--tab-count': 3,
              '--tab-index': mobileTab === 'list' ? 0 : mobileTab === 'split' ? 1 : 2,
              '--tab-gap': '0.25rem',
            } as CSSProperties
          }
        >
          <span className="pointer-events-none absolute inset-1" aria-hidden>
            <span className="tab-slider rounded-full border-2 border-ink bg-sakura-500" />
          </span>
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
              className="cute-press relative min-h-touch min-w-0 rounded-full px-1 text-base font-bold text-ink"
              onClick={() => selectTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>
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
