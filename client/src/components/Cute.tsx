// Decorative pieces for the cute look: mascot, section badge, day scene, snow, flight card.
// Everything here is presentational and aria-hidden unless it carries text.

const INK = '#3b2a20';

/** Shima-enaga (Hokkaido long-tailed tit) wearing a salmon beanie. */
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
      <path d="M47 36 Q57 33 63 27 Q62 33 58 36 Q54 40 48 43 Z" fill="#6b4c3a" stroke={INK} strokeWidth="2.2" strokeLinejoin="round" />
      {/* body */}
      <ellipse cx="31" cy="38" rx="20" ry="17" fill="#fffdf8" stroke={INK} strokeWidth="2.6" />
      {/* wing */}
      <path d="M38 36 q9 2 10 10 q-8 1 -12 -4 z" fill="#c9a58c" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
      {/* beanie */}
      <path d="M14 30 q3 -14 17 -14 q14 0 17 14 q-17 -5 -34 0 z" fill="#e8857a" stroke={INK} strokeWidth="2.4" strokeLinejoin="round" />
      <path d="M14.5 29.5 q16.5 -5 33 0" fill="none" stroke="#fffdf8" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="31" cy="13.5" r="4" fill="#fffdf8" stroke={INK} strokeWidth="2.2" />
      {/* face */}
      <g className="mascot-eyes">
        <circle cx="24" cy="38" r="2.3" fill={INK} />
        <circle cx="37" cy="38" r="2.3" fill={INK} />
      </g>
      <path d="M29 41.5 l2.5 2.4 l2.5 -2.4 z" fill={INK} />
      <ellipse cx="19.5" cy="43" rx="3" ry="1.9" fill="#f6b1a7" />
      <ellipse cx="41.5" cy="43" rx="3" ry="1.9" fill="#f6b1a7" />
      {/* feet */}
      <path d="M26 54.5 v4 M36 54.5 v4" stroke={INK} strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

type BadgeIcon = 'calendar' | 'pin' | 'yen' | 'snow';

/** Round salmon badge that sits beside section titles. */
export function SectionBadge({ icon = 'calendar', className = '' }: { icon?: BadgeIcon; className?: string }) {
  return (
    <span
      className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-sakura-500 ${className}`}
      aria-hidden
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {icon === 'calendar' && (
          <>
            <rect x="4" y="6" width="16" height="14" rx="3" fill="#fde38a" />
            <path d="M4 11h16M9 4v4M15 4v4" />
          </>
        )}
        {icon === 'pin' && (
          <>
            <path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z" fill="#fde38a" />
            <circle cx="12" cy="10" r="2.2" />
          </>
        )}
        {icon === 'yen' && (
          <>
            <circle cx="12" cy="12" r="8" fill="#fde38a" />
            <path d="M9 8l3 4 3-4M12 12v5M9.5 13.5h5" />
          </>
        )}
        {icon === 'snow' && <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9" />}
      </svg>
    </span>
  );
}

/** Tiny illustrated thumbnail for the current-day card. Rotates through a few Hokkaido scenes. */
export function DayScene({ day, className = '' }: { day: number; className?: string }) {
  const scene = ((day - 1) % 3 + 3) % 3;
  return (
    <svg className={className} viewBox="0 0 80 56" aria-hidden focusable="false">
      <rect x="1.5" y="1.5" width="77" height="53" rx="10" fill="#e1f0fa" stroke={INK} strokeWidth="2.5" />
      <circle cx="62" cy="14" r="5" fill="#fde38a" stroke={INK} strokeWidth="1.8" />
      {scene === 0 && (
        <>
          <path d="M4 44 L24 20 L34 32 L46 16 L76 44 Z" fill="#fffdf8" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          <path d="M20 25 l4 -5 l4 5 M42 21 l4 -5 l4 5" fill="none" stroke="#a5d2ee" strokeWidth="2" />
        </>
      )}
      {scene === 1 && (
        <>
          <path d="M4 42 h72" stroke={INK} strokeWidth="2" />
          <rect x="16" y="26" width="34" height="15" rx="5" fill="#e8857a" stroke={INK} strokeWidth="2" />
          <rect x="21" y="30" width="7" height="5" rx="1.5" fill="#fffdf8" stroke={INK} strokeWidth="1.5" />
          <rect x="32" y="30" width="7" height="5" rx="1.5" fill="#fffdf8" stroke={INK} strokeWidth="1.5" />
          <circle cx="23" cy="42" r="2.6" fill={INK} />
          <circle cx="43" cy="42" r="2.6" fill={INK} />
          <path d="M50 30 q8 -4 6 -12" fill="none" stroke="#fffdf8" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      {scene === 2 && (
        <>
          <rect x="4" y="38" width="72" height="16" fill="#b5d898" />
          <circle cx="40" cy="31" r="9" fill="#fffdf8" stroke={INK} strokeWidth="2" />
          <circle cx="40" cy="19" r="6" fill="#fffdf8" stroke={INK} strokeWidth="2" />
          <circle cx="38" cy="18" r="1" fill={INK} />
          <circle cx="42" cy="18" r="1" fill={INK} />
          <path d="M34 24 h12" stroke="#e8857a" strokeWidth="3" strokeLinecap="round" />
        </>
      )}
      <path d="M4 48 q10 -4 18 0 t18 0 t18 0 t18 0 V54.5 H4 Z" fill="#fffdf8" stroke={INK} strokeWidth="2" />
    </svg>
  );
}

const FLAKES = Array.from({ length: 12 }, (_, i) => ({
  left: `${(i * 83) % 100}%`,
  delay: `${-((i * 1.7) % 9)}s`,
  duration: `${7 + ((i * 3) % 6)}s`,
  size: 5 + ((i * 5) % 6),
}));

/** Soft snowfall overlay. Never takes pointer events; hidden for reduced motion. */
export function Snowfall({ className = '' }: { className?: string }) {
  return (
    <div className={`snowfall pointer-events-none ${className}`} aria-hidden>
      {FLAKES.map((f, i) => (
        <span
          key={i}
          className="snowflake"
          style={{ left: f.left, animationDelay: f.delay, animationDuration: f.duration, width: f.size, height: f.size }}
        />
      ))}
    </div>
  );
}

const FLIGHT_RE = /^\s*([A-Za-z0-9]{2,4})\s+(\d{1,2}:\d{2})\s*(?:→|->|-)\s*([A-Za-z0-9]{2,4})\s+(\d{1,2}:\d{2})\s*$/;

/** Mint-headed boarding card. Falls back to the plain text when the format is not "AAA 10:00 → BBB 12:00". */
export function FlightCard({ title, text }: { title: string; text: string }) {
  const m = FLIGHT_RE.exec(text || '');
  return (
    <div className="cute-pop overflow-hidden rounded-2xl border-2 border-ink bg-white text-ink shadow-sticker-sm">
      <div className="border-b-2 border-ink bg-mint-300 px-3 py-1 text-sm font-bold">{title}</div>
      {m ? (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="shrink-0">
            <p className="text-2xl font-bold leading-none tracking-wide">{m[2]}</p>
            <p className="mt-1 text-sm text-slate-600">{m[1]}</p>
          </div>
          <span className="mx-1 h-0 flex-1 border-t-[3px] border-dotted border-ink/70" aria-hidden />
          <span aria-hidden className="text-lg">✈︎</span>
          <span className="mx-1 h-0 flex-1 border-t-[3px] border-dotted border-ink/70" aria-hidden />
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
