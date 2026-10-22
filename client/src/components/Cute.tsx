// Decorative Hokkaido pieces: mascots, section badge, day scenes, header snow, scenery band, flight card.
// Everything here is presentational and aria-hidden unless it carries text.

const INK = '#2d2a4a';
const MILK = '#fffcf5';
const LAVENDER = '#c7b5ee';
const LAVENDER_DEEP = '#9b7fdb';
const LAKE = '#52b8df';
const LAKE_LIGHT = '#dff2fa';
const GRASS = '#a6d985';
const BUTTER = '#ffe38f';
const CRAB = '#e8583e';
const BLUSH = '#f6b8c4';
const JR_GREEN = '#3baa35';

/** Shima-enaga (Hokkaido long-tailed tit) in a lavender beanie and a blue-pond scarf. */
export function Mascot({ className = '', size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      className={`mascot ${className}`}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
    >
      {/* tail */}
      <path d="M47 36 Q57 33 63 27 Q62 33 58 36 Q54 40 48 43 Z" fill="#4a3f5c" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      {/* body */}
      <ellipse cx="31" cy="38" rx="20" ry="17" fill={MILK} stroke={INK} strokeWidth="2.6" />
      {/* wing */}
      <path d="M38 35 q9 2 10 10 q-8 1 -12 -4 z" fill="#6d5a7a" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {/* scarf */}
      <path d="M15 46 q16 7 32 0 l-1 4.5 q-15 6.5 -30 0 z" fill={LAKE} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      <path d="M20 49 l-3 7 l5 -1 l1 -5" fill={LAKE} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {/* beanie */}
      <path d="M14 30 q3 -14 17 -14 q14 0 17 14 q-17 -5 -34 0 z" fill={LAVENDER} stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M22 18.5 v8 M31 16 v9 M40 18.5 v8" stroke={LAVENDER_DEEP} strokeWidth="1.6" strokeLinecap="round" />
      <path d="M14.5 29.5 q16.5 -5 33 0" fill="none" stroke={MILK} strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="31" cy="13.5" r="4" fill={CRAB} stroke={INK} strokeWidth="2.2" />
      {/* face */}
      <g className="mascot-eyes">
        <circle cx="24" cy="37" r="2.3" fill={INK} />
        <circle cx="37" cy="37" r="2.3" fill={INK} />
        <circle cx="24.8" cy="36.2" r="0.7" fill={MILK} />
        <circle cx="37.8" cy="36.2" r="0.7" fill={MILK} />
      </g>
      <path d="M29 40.5 l2.5 2.4 l2.5 -2.4 z" fill={INK} />
      <ellipse cx="19.5" cy="42" rx="3" ry="1.9" fill={BLUSH} />
      <ellipse cx="41.5" cy="42" rx="3" ry="1.9" fill={BLUSH} />
      {/* feet */}
      <path d="M26 54.5 v4 M36 54.5 v4" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

/** Kitakitsune (Hokkaido red fox) with a lavender sprig — the mascot's travel buddy. */
export function Fox({ className = '', size = 48 }: { className?: string; size?: number }) {
  return (
    <svg className={`mascot ${className}`} width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      {/* tail */}
      <path d="M44 48 q16 -2 16 -16 q-8 4 -12 4 q-6 2 -8 8 z" fill="#f0a050" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M56 37 q3 -2 4 -5 q-4 2 -6 2 z" fill={MILK} stroke={INK} strokeWidth="1.6" strokeLinejoin="round" />
      {/* body */}
      <path d="M20 58 q-2 -16 12 -18 q14 2 12 18 z" fill="#f0a050" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M27 58 q0 -10 5 -12 q5 2 5 12 z" fill={MILK} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      {/* ears */}
      <path d="M15 22 L17 5 L28 16 Z" fill="#f0a050" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M49 22 L47 5 L36 16 Z" fill="#f0a050" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M18 10 L19 17 L23 15 Z M46 10 L45 17 L41 15 Z" fill="#4a3f5c" />
      {/* head */}
      <path d="M12 26 q2 -14 20 -14 q18 0 20 14 q-2 12 -20 16 q-18 -4 -20 -16 z" fill="#f0a050" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M14 29 q8 1 12 6 q4 5 6 7 q2 -2 6 -7 q4 -5 12 -6 q-3 9 -18 13 q-15 -4 -18 -13 z" fill={MILK} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
      <g className="mascot-eyes">
        <circle cx="24" cy="27" r="2.2" fill={INK} />
        <circle cx="40" cy="27" r="2.2" fill={INK} />
      </g>
      <ellipse cx="32" cy="35" rx="2.6" ry="2" fill={INK} />
      <ellipse cx="19" cy="32" rx="2.6" ry="1.6" fill={BLUSH} />
      <ellipse cx="45" cy="32" rx="2.6" ry="1.6" fill={BLUSH} />
      {/* lavender sprig */}
      <path d="M44 16 q4 -6 3 -12" fill="none" stroke="#5a8f3c" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="47" cy="5" r="2" fill={LAVENDER_DEEP} />
      <circle cx="46" cy="8.5" r="2" fill={LAVENDER_DEEP} />
      <circle cx="45" cy="12" r="1.8" fill={LAVENDER} />
    </svg>
  );
}

type BadgeIcon = 'calendar' | 'pin' | 'yen' | 'snow';

/** Round lavender badge that sits beside section titles. */
export function SectionBadge({ icon = 'calendar', className = '' }: { icon?: BadgeIcon; className?: string }) {
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-circle border-2 border-ink bg-lavender-300 ${className}`}
      aria-hidden
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {icon === 'calendar' && (
          <>
            <rect x="4" y="6" width="16" height="14" rx="3" fill={BUTTER} />
            <path d="M4 11h16M9 4v4M15 4v4" />
          </>
        )}
        {icon === 'pin' && (
          <>
            <path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z" fill={BUTTER} />
            <circle cx="12" cy="10" r="2.2" />
          </>
        )}
        {icon === 'yen' && (
          <>
            <circle cx="12" cy="12" r="8" fill={BUTTER} />
            <path d="M9 8l3 4 3-4M12 12v5M9.5 13.5h5" />
          </>
        )}
        {icon === 'snow' && <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />}
      </svg>
    </span>
  );
}

/** Tiny illustrated thumbnail for the current-day card: lavender field, Blue Pond, JR train, snowman. */
export function DayScene({ day, className = '' }: { day: number; className?: string }) {
  const scene = ((day - 1) % 4 + 4) % 4;
  return (
    <svg className={`day-scene ${className}`} viewBox="0 0 80 56" aria-hidden focusable="false">
      <defs>
        <clipPath id={`scene-clip-${scene}`}>
          <rect x="1.5" y="1.5" width="77" height="53" rx="10" />
        </clipPath>
      </defs>
      <rect x="1.5" y="1.5" width="77" height="53" rx="10" fill={LAKE_LIGHT} />
      <g clipPath={`url(#scene-clip-${scene})`}>
        <circle cx="64" cy="13" r="5" fill={BUTTER} stroke={INK} strokeWidth="1.8" />
        {scene === 0 && (
          <>
            <path d="M0 30 q20 -12 40 -4 t40 -2 V56 H0 Z" fill={GRASS} stroke={INK} strokeWidth="1.8" />
            {[34, 40, 46, 52].map((y, i) => (
              <path key={y} d={`M-2 ${y} q20 -6 42 -2 t44 -2`} fill="none" stroke={i % 2 ? LAVENDER : LAVENDER_DEEP} strokeWidth="4" strokeLinecap="round" />
            ))}
          </>
        )}
        {scene === 1 && (
          <>
            <rect x="0" y="30" width="80" height="26" fill={GRASS} />
            <ellipse cx="40" cy="44" rx="30" ry="9" fill={LAKE} stroke={INK} strokeWidth="1.8" />
            <path d="M24 44 q8 -2 14 0 M44 47 q6 -2 12 0" stroke={MILK} strokeWidth="1.6" strokeLinecap="round" />
            {[16, 34, 50].map((x) => (
              <g key={x}>
                <rect x={x} y="12" width="3.6" height="32" rx="1.5" fill={MILK} stroke={INK} strokeWidth="1.5" />
                <path d={`M${x + 0.6} 20 h2 M${x + 1.2} 28 h2 M${x + 0.6} 36 h2`} stroke={INK} strokeWidth="1.3" />
              </g>
            ))}
          </>
        )}
        {scene === 2 && (
          <>
            <path d="M0 34 L20 16 L32 26 L46 12 L80 34 V56 H0 Z" fill={MILK} stroke={INK} strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M2 45 h76" stroke={INK} strokeWidth="2" />
            <rect x="14" y="30" width="40" height="14" rx="5" fill={MILK} stroke={INK} strokeWidth="2" />
            <rect x="14" y="38" width="40" height="3" fill={JR_GREEN} />
            <rect x="19" y="33" width="7" height="4" rx="1.5" fill={LAKE} stroke={INK} strokeWidth="1.2" />
            <rect x="30" y="33" width="7" height="4" rx="1.5" fill={LAKE} stroke={INK} strokeWidth="1.2" />
            <rect x="41" y="33" width="7" height="4" rx="1.5" fill={LAKE} stroke={INK} strokeWidth="1.2" />
            <circle cx="22" cy="45" r="2.4" fill={INK} />
            <circle cx="46" cy="45" r="2.4" fill={INK} />
          </>
        )}
        {scene === 3 && (
          <>
            <rect x="0" y="40" width="80" height="16" fill={MILK} />
            <circle cx="40" cy="36" r="9" fill={MILK} stroke={INK} strokeWidth="2" />
            <circle cx="40" cy="23" r="6.5" fill={MILK} stroke={INK} strokeWidth="2" />
            <circle cx="37.8" cy="22.5" r="1" fill={INK} />
            <circle cx="42.2" cy="22.5" r="1" fill={INK} />
            <path d="M33 28 h14" stroke={CRAB} strokeWidth="3" strokeLinecap="round" />
            <path d="M34 16 q6 -6 12 0 z" fill={LAVENDER} stroke={INK} strokeWidth="1.6" />
            {[12, 22, 58, 68].map((x, i) => (
              <circle key={x} cx={x} cy={10 + (i % 2) * 14} r="1.6" fill={MILK} stroke={LAKE} strokeWidth="0.8" />
            ))}
          </>
        )}
      </g>
      <rect x="1.5" y="1.5" width="77" height="53" rx="10" fill="none" stroke={INK} strokeWidth="2.5" />
    </svg>
  );
}

// A handful of flakes and lavender petals; only transform/opacity animate.
const FLAKES = Array.from({ length: 11 }, (_, i) => ({
  petal: i % 3 === 2,
  left: `${(i * 89 + 7) % 100}%`,
  delay: `${-((i * 1.9) % 10)}s`,
  duration: `${8 + ((i * 3) % 6)}s`,
  size: i % 3 === 2 ? 7 : 4 + ((i * 5) % 5),
}));

/** Soft snow and lavender petals drifting in the header. Never takes pointer events; hidden for reduced motion. */
export function Snowfall({ className = '' }: { className?: string }) {
  return (
    <div className={`snowfall pointer-events-none ${className}`} aria-hidden>
      {FLAKES.map((f, i) => (
        <span
          key={i}
          className={f.petal ? 'snowflake petal' : 'snowflake'}
          style={{ left: f.left, animationDelay: f.delay, animationDuration: f.duration, width: f.size, height: f.size }}
        />
      ))}
    </div>
  );
}

const STARS = Array.from({ length: 14 }, (_, i) => ({
  left: `${(i * 37 + 11) % 100}%`,
  top: `${(i * 53 + 9) % 86}%`,
  delay: `${-((i * 0.7) % 3.6)}s`,
  size: i % 4 === 0 ? 3 : 2,
}));

/**
 * Header backdrop for every theme. CSS shows the part that belongs to the active theme:
 * snow and petals (cute), nothing (minimal), twinkling stars over a drifting aurora (night).
 */
export function HeaderSky() {
  return (
    <>
      <Snowfall />
      <div className="aurora pointer-events-none" aria-hidden>
        <span className="aurora-band" />
      </div>
      <div className="stars pointer-events-none" aria-hidden>
        {STARS.map((s, i) => (
          <span key={i} className="star" style={{ left: s.left, top: s.top, animationDelay: s.delay, width: s.size, height: s.size }} />
        ))}
      </div>
    </>
  );
}

/** Scenery strip for the welcome and loading pages: snowy peaks, lavender rows and a JR train rolling by. */
export function HokkaidoBand({ className = '' }: { className?: string }) {
  return (
    <div className={`hokkaido-band relative h-16 overflow-hidden rounded-2xl border-2 border-ink bg-bluebell-100 ${className}`} aria-hidden>
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 320 64" preserveAspectRatio="xMidYMax slice" focusable="false">
        <path d="M0 44 L40 18 L62 32 L96 8 L140 40 L176 20 L210 36 L248 12 L290 34 L320 22 V64 H0 Z" fill={MILK} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
        <path d="M88 13 l8 -5 l8 8 M240 17 l8 -5 l8 8" fill="none" stroke={LAKE} strokeWidth="2" strokeLinecap="round" />
        <rect x="0" y="44" width="320" height="20" fill={GRASS} />
        {[49, 55, 61].map((y, i) => (
          <path key={y} d={`M-4 ${y} Q80 ${y - 4} 160 ${y} T324 ${y}`} fill="none" stroke={i % 2 ? LAVENDER : LAVENDER_DEEP} strokeWidth="3.4" strokeLinecap="round" />
        ))}
        <path d="M0 44 H320" stroke={INK} strokeWidth="2" />
      </svg>
      <div className="train-run absolute bottom-[19px] left-0">
        <svg width="66" height="20" viewBox="0 0 66 20" focusable="false">
          <rect x="1" y="1" width="30" height="15" rx="5" fill={MILK} stroke={INK} strokeWidth="2" />
          <rect x="34" y="1" width="30" height="15" rx="4" fill={MILK} stroke={INK} strokeWidth="2" />
          <rect x="1" y="10" width="30" height="3" fill={JR_GREEN} />
          <rect x="34" y="10" width="30" height="3" fill={JR_GREEN} />
          <rect x="5" y="4" width="6" height="4" rx="1" fill={LAKE} />
          <rect x="14" y="4" width="6" height="4" rx="1" fill={LAKE} />
          <rect x="38" y="4" width="6" height="4" rx="1" fill={LAKE} />
          <rect x="47" y="4" width="6" height="4" rx="1" fill={LAKE} />
          <rect x="56" y="4" width="5" height="5" rx="1.5" fill={LAKE} />
          <circle cx="8" cy="17" r="2.2" fill={INK} />
          <circle cx="24" cy="17" r="2.2" fill={INK} />
          <circle cx="41" cy="17" r="2.2" fill={INK} />
          <circle cx="57" cy="17" r="2.2" fill={INK} />
        </svg>
      </div>
    </div>
  );
}

const FLIGHT_RE = /^\s*([A-Za-z0-9]{2,4})\s+(\d{1,2}:\d{2})\s*(?:→|->|-)\s*([A-Za-z0-9]{2,4})\s+(\d{1,2}:\d{2})\s*$/;

/** Lake-blue boarding card. Falls back to the plain text when the format is not "AAA 10:00 → BBB 12:00". */
export function FlightCard({ title, text }: { title: string; text: string }) {
  const m = FLIGHT_RE.exec(text || '');
  return (
    <div className="cute-pop overflow-hidden rounded-2xl border-2 border-ink bg-white text-ink shadow-sticker-sm">
      <div className="flex items-center justify-between border-b-2 border-ink bg-bluebell-200 px-3 py-1 text-sm font-bold">
        <span>{title}</span>
        <span aria-hidden>❄</span>
      </div>
      {m ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="shrink-0">
            <p className="text-2xl font-bold leading-none tracking-wide">{m[2]}</p>
            <p className="mt-1 text-sm text-slate-600">{m[1]}</p>
          </div>
          <span className="mx-1 h-0 flex-1 border-t-[3px] border-dotted border-ink/60" aria-hidden />
          <span aria-hidden className="plane-float text-lg text-ice-600">✈︎</span>
          <span className="mx-1 h-0 flex-1 border-t-[3px] border-dotted border-ink/60" aria-hidden />
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold leading-none tracking-wide">{m[4]}</p>
            <p className="mt-1 text-sm text-slate-600">{m[3]}</p>
          </div>
        </div>
      ) : (
        <p className="px-3 py-2 text-sm">{text}</p>
      )}
    </div>
  );
}
