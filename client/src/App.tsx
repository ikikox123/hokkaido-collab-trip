import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { connectRealtime, type RealtimeSocket } from './lib/realtime';
import type { FxView } from '../../server/src/fx.js';
import { LoginModal } from './components/LoginModal';
import { TripAlerts } from './components/TripAlerts';
import { TripList } from './components/TripList';
import { MapView } from './components/MapView';
import { LodgingDialog, type LodgingDraft } from './components/LodgingDialog';
import { PlaceStopDialog, type PickedPlace } from './components/PlaceStopDialog';
import { SplitBoard } from './components/SplitBoard';
import { useI18n } from './i18n/I18nProvider';
import { displayDayLabel, pageHeading } from './i18n/screen.ts';
import { displayStopTitle } from './i18n/stopNames';
import { localizeError } from './i18n/errors';
import { DayScene, FlightCard, Fox, HeaderSky, HokkaidoBand, Mascot } from './components/Cute';
import { DayLabelEditButton, DayLabelEditor } from './components/DayLabelEditor';
import { HeaderMenu } from './components/HeaderMenu';
import { LanguagePill } from './components/LanguagePill';
import { DayTimeline } from './components/DayTimeline';
import { clearAuth, getStoredUser, getToken } from './lib/auth';
import { emitAck } from './lib/bill';
import { SAPPORO_BASE } from './lib/dayView';
import { usesGoogleMaps } from './lib/mapProvider';
import { shareLocation } from './lib/sharePath';
import { isSplitPath, leaveSplit, openSplit } from './lib/splitLink';
import type { Leg, PresenceUser, Stop, TravelMode, TripState, User } from './types/trip';

type MobileTab = 'list' | 'map' | 'split';

function CurrentStopBar({
  stop,
  day,
  position,
  rawLabel,
  dayLabel,
  lodgingName,
  onRenameDay,
}: {
  stop: Stop | null;
  day: number;
  /** 1-based position of the day in the trip. */
  position: number;
  /** Stored days[].label, edited as typed. */
  rawLabel: string;
  /** Label shown on screen (locale-adjusted D-prefix). */
  dayLabel: string;
  lodgingName: string;
  /** Present only for trip companions. */
  onRenameDay?: (label: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const { t, locale } = useI18n();
  const [editing, setEditing] = useState(false);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => setEditing(false), [day]);
  useEffect(() => {
    if (wasEditing.current && !editing) editButtonRef.current?.focus({ preventScroll: true });
    wasEditing.current = editing;
  }, [editing]);

  return (
    <div className="z-20 shrink-0 bg-snow-50 px-3 py-2">
      <div
        key={`${day}-${stop?.id ?? 'none'}`}
        className={`day-card cute-enter flex min-h-touch items-center gap-3 rounded-2xl border-2 border-ink bg-lavender-100 p-2 shadow-sticker ${
          editing ? '' : 'cute-pop'
        }`}
      >
        {!editing && <DayScene day={day} className="h-12 w-[4.25rem] shrink-0" />}
        {editing && onRenameDay ? (
          <div className="min-w-0 flex-1">
            <DayLabelEditor label={rawLabel} position={position} onSave={onRenameDay} onClose={() => setEditing(false)} />
          </div>
        ) : (
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <span className="day-card-label truncate">{dayLabel}</span>
            {onRenameDay && (
              <DayLabelEditButton
                label={rawLabel}
                shownLabel={dayLabel}
                buttonRef={editButtonRef}
                onOpen={() => setEditing(true)}
              />
            )}
            <span className="shrink-0 rounded-full border-[1.5px] border-ink bg-white px-1.5 text-[11px] font-bold leading-4 text-ink">
              {t('currentStop')}
            </span>
          </p>
          {stop ? (
            <p className="truncate text-base font-bold leading-snug text-ink">
              <span className="mr-1.5 text-crab-600">{stop.time || t('timeUnset')}</span>
              {displayStopTitle(locale, stop.title)}
            </p>
          ) : (
            <p className="truncate text-base font-semibold text-slate-500">{t('noStopsToday')}</p>
          )}
          <p className="truncate text-xs text-slate-500">{t('lodgingLine', { name: lodgingName })}</p>
        </div>
        )}
      </div>
    </div>
  );
}

/** "2027-02-12～18" → "2/12–2/18". Anything else is shown as typed. */
function shortRange(part: string) {
  const m = /^\d{4}-(\d{2})-(\d{2})\s*[～~–-]\s*(?:\d{4}-)?(?:(\d{2})-)?(\d{2})$/.exec(part);
  if (!m) return part;
  const [, m1, d1, m2, d2] = m;
  return `${Number(m1)}/${Number(d1)}–${Number(m2 ?? m1)}/${Number(d2)}`;
}

/**
 * Fits the title without an ugly cut: one line at full size, then one line a little smaller,
 * then two balanced lines, then two smaller lines. Watches size and text (also edits made outside React).
 */
function useFitTitle() {
  const ref = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      for (const step of ['1', '2', '3', '4']) {
        el.setAttribute('data-fit', step);
        const over = step <= '2' ? el.scrollWidth > el.clientWidth + 1 : el.scrollHeight > el.clientHeight + 1;
        if (!over) return;
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement ?? el);
    const mo = new MutationObserver(fit);
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, []);
  return ref;
}

/**
 * Brand badge, the trip title as the hero (up to two lines), one quiet meta line,
 * then the language pill and the menu button.
 */
function AppHeader({ subtitle, menu, className = '' }: { subtitle?: string; menu: ReactNode; className?: string }) {
  const { locale } = useI18n();
  const heading = pageHeading(locale);
  const titleRef = useFitTitle();
  const meta = (subtitle ?? '')
    .split('｜')
    .map((part) => shortRange(part.trim()))
    .filter(Boolean)
    .join(' · ');
  return (
    <header
      className={`app-header th-glass relative z-20 shrink-0 overflow-hidden border-b-2 border-ink bg-gradient-to-r from-lavender-100 via-snow-50 to-bluebell-100 text-ink ${className}`}
    >
      <HeaderSky />
      <div className="relative flex min-h-[3.75rem] items-center gap-2.5 px-3 py-2 sm:px-4">
        <span className="brand-badge" aria-hidden>
          <span className="brand-mascot mascot-bob">
            <Mascot size={30} />
          </span>
          <span className="brand-mark">雪</span>
        </span>
        <div className="min-w-0 flex-1">
          <h1 ref={titleRef} className="header-title" title={heading}>
            <span className="header-title-text">{heading}</span>
          </h1>
          {meta && (
            <p className="header-meta" title={subtitle}>
              {meta}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <LanguagePill />
          {menu}
        </div>
      </div>
    </header>
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

  async function renameDay(label: string) {
    if (!socket || !token) {
      showToast(t('loginToEdit'));
      setLoginOpen(true);
      return { ok: false, error: '請先登入才能編輯' };
    }
    const result = await emitAck(socket, 'trip:setDayLabel', { day: selectedDay, label, token });
    if (result.ok) showToast(t('dayLabelSaved'));
    return result;
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
        <AppHeader
          className="pt-[var(--safe-top)]"
          menu={<HeaderMenu open={headerOpen} onOpenChange={setHeaderOpen} shareScope={{ kind: 'all' }} lang={locale} />}
        />
        <main className="cute-enter mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
          <div className="hero-art relative mt-7" data-reveal>
            <HokkaidoBand />
            <div className="pointer-events-none absolute -top-8 right-3 flex items-end gap-0.5" aria-hidden>
              <span className="mascot-bob block">
                <Mascot size={44} />
              </span>
              <Fox size={52} />
            </div>
          </div>
          <p className="text-sm leading-relaxed text-slate-600" data-reveal>{t('collabNeedsLogin')}</p>
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
        <AppHeader
          className="pt-[var(--safe-top)]"
          menu={
            <HeaderMenu
              open={headerOpen}
              onOpenChange={setHeaderOpen}
              shareScope={{ kind: 'all' }}
              lang={locale}
              account={{ name: user.displayName, onLogout: handleLogout }}
            />
          }
        />
        <main className="cute-enter mx-auto flex w-full max-w-md flex-col gap-4 px-4 py-5">
          <div className="hero-art relative mt-7" data-reveal>
            <HokkaidoBand />
            <div className="pointer-events-none absolute -top-8 right-3 flex items-end gap-0.5" aria-hidden>
              <span className="mascot-bob block">
                <Mascot size={44} />
              </span>
              <Fox size={52} />
            </div>
          </div>
          <p className="text-sm leading-relaxed text-slate-600" data-reveal>{t('notCompanionYet')}</p>
          <a
            href={shareLocation({ kind: 'all' }, locale)}
            className="cute-pop flex min-h-touch items-center justify-center rounded-full border-2 border-ink bg-mint-200 px-3 text-base font-bold text-ink shadow-sticker"
          >
            {t('shareOpen')}
          </a>
          <p className="text-sm leading-relaxed text-slate-600">{t('shareCanExport')}</p>
          <button
            type="button"
            className="cute-pop flex min-h-touch items-center justify-center rounded-full border-2 border-ink bg-lavender-300 px-3 text-base font-bold text-ink shadow-sticker"
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
          <LanguagePill />
          <HeaderMenu
            open={headerOpen}
            onOpenChange={setHeaderOpen}
            shareScope={{ kind: 'day', day: selectedDay }}
            lang={locale}
            account={{ name: user.displayName, onLogout: handleLogout }}
          />
        </div>
        <div className="w-full max-w-xs text-center px-6">
          <div className="hero-art mb-1 flex items-end justify-center gap-1">
            <span className="mascot-bob block">
              <Mascot size={64} />
            </span>
            <Fox size={70} />
          </div>
          <HokkaidoBand />
          <p className="mt-3 font-semibold">{t('loadingTrip')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`app-enter flex flex-col bg-snow-50 text-ink pt-[var(--safe-top)] pb-[calc(var(--tabbar-h)+1rem)] md:h-[100dvh] md:overflow-hidden md:pb-0 ${
        mobileTab === 'map' ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]'
      }`}>
      {/* Top bar: brand and title on the left, everything else behind one menu button */}
      <AppHeader
        subtitle={trip.tripName.includes('｜') ? trip.tripName.split('｜').slice(1).join('｜') : t('collabFallback')}
        menu={
          <HeaderMenu
            open={headerOpen}
            onOpenChange={setHeaderOpen}
            shareScope={{ kind: 'day', day: selectedDay }}
            lang={locale}
            account={user ? { name: user.displayName, onLogout: handleLogout } : null}
            onLogin={user ? undefined : () => setLoginOpen(true)}
          >
            <section className="menu-section">
              <h3 className="menu-heading">{t('menuTripSection')}</h3>
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{t('roomCode')}</span>
                  <input
                    className="min-h-touch min-w-[8rem] flex-1 rounded-lg border border-ink bg-white px-3 font-bold tracking-wider text-ink placeholder:text-slate-400"
                    value={roomCode}
                    onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                    placeholder={DEFAULT_ROOM}
                  />
                  <button
                    type="button"
                    className="cute-pop min-h-touch rounded-full border-2 border-ink bg-lavender-300 px-4 font-bold text-ink shadow-sticker-sm"
                    onClick={joinRoom}
                  >
                    {t('join')}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700">
                  <span className="inline-flex items-center gap-1 rounded-full border-2 border-ink bg-mint-100 px-2 font-bold text-ink">
                    <span className="h-2 w-2 rounded-circle bg-mint-500" aria-hidden />
                    {t('onlineCount', { count: online.length })}
                  </span>
                  <span className="max-w-full truncate">
                    {online.map((o) => o.displayName).join(t('listSep')) || t('noneYet')}
                  </span>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border-2 border-ink bg-white px-3 py-1">
                  <div className="min-w-0 flex-1 truncate font-semibold text-ink">
                    {t('lodgingLine', { name: trip.lodging?.name?.trim() || t('lodgingUnset') })}
                  </div>
                  {canEdit && isTripCompanion && (
                    <button
                      type="button"
                      className="cute-press min-h-touch shrink-0 rounded-full border-2 border-ink bg-mint-200 px-3 text-sm font-bold text-ink"
                      onClick={() => {
                        setHeaderOpen(false);
                        setLodgingOpen(true);
                      }}
                    >
                      {t('editLodging')}
                    </button>
                  )}
                </div>
                <div className="grid gap-2">
                  <FlightCard title={t('outboundLine', { text: '' }).trim()} text={trip.flights.outbound} />
                  <FlightCard title={t('inboundLine', { text: '' }).trim()} text={trip.flights.inbound} />
                </div>
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
            </section>
          </HeaderMenu>
        }
      />

      {/* Day strip stays outside the list scroller. Hidden on the phone bill tab. */}
      {!mobileSplit && <DayTimeline days={trip.days} selectedDay={selectedDay} onSelect={setSelectedDay} />}

      {!mobileSplit && (
        <CurrentStopBar
          stop={dayStops.find((s) => s.id === selectedId) ?? null}
          day={selectedDay}
          position={Math.max(1, trip.days.findIndex((d) => d.day === selectedDay) + 1)}
          rawLabel={trip.days.find((d) => d.day === selectedDay)?.label ?? ''}
          dayLabel={displayDayLabel(locale, trip.days.find((d) => d.day === selectedDay)?.label ?? `D${selectedDay}`)}
          lodgingName={trip.lodging?.name?.trim() || t('lodgingUnset')}
          onRenameDay={isTripCompanion ? renameDay : undefined}
        />
      )}

      {!mobileSplit && <TripAlerts />}

      {/* Main: stacked on mobile via tabs; side-by-side on md+ */}
      <main className={`flex flex-1 flex-col md:min-h-0 md:flex-row ${mobileTab === 'map' ? 'min-h-0' : ''}`}>
        <section
          className={`cute-paper flex-1 flex-col border-ink md:min-h-0 md:w-[42%] md:max-w-md md:border-r-2 ${
            mobileTab === 'map' ? 'hidden md:flex' : 'flex'
          }`}
        >
          <div className="hidden shrink-0 border-b-2 border-ink bg-snow-50 p-2 md:block">
            <div
              className="relative grid grid-cols-2 gap-1 rounded-full border-2 border-ink bg-white p-1"
              style={{ '--tab-count': 2, '--tab-index': mobileTab === 'split' ? 1 : 0, '--tab-gap': '0.25rem' } as CSSProperties}
            >
              <span className="pointer-events-none absolute inset-1" aria-hidden>
                <span className="tab-slider rounded-full border-2 border-ink bg-lavender-300" />
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
          <div className="flex-1 md:min-h-0">
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
        className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-snow-50 px-3 pt-2 md:hidden"
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
            <span className="tab-slider rounded-full border-2 border-ink bg-lavender-300" />
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
