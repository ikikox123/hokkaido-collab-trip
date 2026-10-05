import { useEffect, useRef, useState } from 'react';
import { LanguageMenu } from '../i18n/LanguageMenu';
import { useI18n } from '../i18n/I18nProvider';
import { pageHeading } from '../i18n/screen.ts';
import type { Locale } from '../i18n/messages.ts';
import { ShareExportBar } from './ShareExportBar';
import { ShareNotice, useTimedNotice } from './ShareNotice';
import { shareOrCopy, sharePageUrl } from '../lib/shareLink';
import {
  captureSharePng,
  deliverSharePng,
  pngFile,
  printSharePdf,
  shareExportFilename,
  shareImageNoticeKey,
  takeShareExport,
} from '../lib/shareExport';
import { parseShareLang, parseShareScope, shareLocation, type ShareScope } from '../lib/sharePath';
import {
  formatLodgingPoint,
  isShareTrip,
  shareDayHeading,
  shareDays,
  shareLodgingDisplay,
  shareStopDisplay,
  shareTripSubtitle,
  type ShareTrip,
} from '../lib/shareView';

function chipClass(active: boolean) {
  return `min-h-touch shrink-0 rounded-xl px-3 py-1 text-left text-sm font-semibold ${
    active ? 'bg-ice-600 text-white shadow' : 'bg-white text-slate-600 ring-1 ring-slate-200'
  }`;
}

export function SharePage() {
  const { locale, setDisplayLocale, t } = useI18n();
  const [scope, setScope] = useState<ShareScope>(() => parseShareScope(window.location.search));
  const [trip, setTrip] = useState<ShareTrip | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [readyFile, setReadyFile] = useState<File | null>(null);
  const exportRootRef = useRef<HTMLDivElement>(null);
  const scopeRef = useRef(scope);
  const localeRef = useRef(locale);
  const { notice, flash, dismiss } = useTimedNotice();
  const flashRef = useRef(flash);
  const tRef = useRef(t);
  scopeRef.current = scope;
  localeRef.current = locale;
  flashRef.current = flash;
  tRef.current = t;

  useEffect(() => {
    const sync = () => {
      setScope(parseShareScope(window.location.search));
      setDisplayLocale(parseShareLang(window.location.search));
    };
    sync();
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('popstate', sync);
      setDisplayLocale(null);
    };
  }, [setDisplayLocale]);

  useEffect(() => {
    const active = document.querySelector<HTMLButtonElement>('.share-toolbar nav button[aria-pressed="true"]');
    const nav = active?.parentElement;
    if (!active || !nav) return;
    const target = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, target) });
  }, [scope, trip, locale]);

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();
    setFailed(false);
    fetch('/api/share', { signal: ctrl.signal, headers: { accept: 'application/json' } })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body: unknown = await res.json();
        if (!isShareTrip(body)) throw new Error('shape');
        if (!cancelled) setTrip(body);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setFailed(true);
      });
    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, []);

  useEffect(() => {
    if (failed) takeShareExport();
  }, [failed]);

  useEffect(() => {
    if (!trip) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const kind = takeShareExport();
      if (!kind) return;
      if (kind === 'pdf') {
        printSharePdf();
        return;
      }
      const node = exportRootRef.current;
      const translate = tRef.current;
      if (!node) {
        flashRef.current(translate('shareExportFailed'));
        return;
      }
      setBusy(true);
      flashRef.current(translate('shareExporting'));
      const filename = shareExportFilename(scopeRef.current, localeRef.current);
      void captureSharePng(node)
        .then((blob) => {
          setBusy(false);
          if (cancelled) return null;
          return handoffImage(pngFile(blob, filename));
        })
        .catch(() => {
          if (!cancelled) flashRef.current(tRef.current('shareExportFailed'));
          setBusy(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [trip]);

  function pickLang(next: Locale) {
    setDisplayLocale(next);
    const href = shareLocation(scope, next);
    const current = `${window.location.pathname.replace(/\/+$/, '') || '/'}${window.location.search}`;
    if (current !== href) window.history.replaceState({ view: 'share' }, '', href);
  }

  function selectScope(next: ShareScope) {
    const href = shareLocation(next, locale);
    const current = `${window.location.pathname.replace(/\/+$/, '') || '/'}${window.location.search}`;
    if (current !== href) {
      window.history.pushState({ view: 'share' }, '', href);
    }
    setScope(next);
    window.scrollTo({ top: 0 });
  }

  async function onCopy() {
    const url = sharePageUrl(window.location.origin, scope, locale);
    try {
      const mode = await shareOrCopy(url);
      flash(mode === 'copied' ? t('shareCopied') : t('shareOpened'));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (err instanceof Error && err.name === 'AbortError') return;
      flash(t('shareCopyFailed'));
    }
  }

  async function handoffImage(file: File) {
    const outcome = await deliverSharePng(file, { hint: t('shareImageLongPress') });
    if (outcome === 'cancelled') return;
    if (outcome === 'needs-gesture') {
      dismiss();
      setReadyFile(file);
      return;
    }
    setReadyFile(null);
    const key = shareImageNoticeKey(outcome);
    if (key) flash(t(key));
  }

  async function onImage() {
    const node = exportRootRef.current;
    if (!node || busy) return;
    setBusy(true);
    dismiss();
    setReadyFile(null);
    flash(t('shareExporting'));
    try {
      const blob = await captureSharePng(node);
      setBusy(false);
      await handoffImage(pngFile(blob, shareExportFilename(scope, locale)));
    } catch {
      flash(t('shareExportFailed'));
      setBusy(false);
    }
  }

  function onPdf() {
    if (!trip || busy) return;
    printSharePdf();
  }

  const lodging = shareLodgingDisplay(trip?.lodging);
  const subtitle = shareTripSubtitle(trip?.tripName);
  const viewed = trip ? shareDays(trip, scope) : { days: [], unknownDay: false };
  const bar = (
    <ShareExportBar
      canExport={Boolean(trip)}
      busy={busy}
      placement="top"
      onCopy={() => void onCopy()}
      onImage={() => void onImage()}
      onPdf={onPdf}
    />
  );

  return (
    <div className="share-root min-h-full bg-snow-50 text-slate-800">
      <div className="share-sheet mx-auto min-h-full max-w-2xl px-4 pb-[calc(5.75rem+var(--safe-bottom))] md:pb-[max(2.5rem,var(--safe-bottom))]">
        <div
          className="share-toolbar share-export-ignore sticky top-0 z-20 -mx-4 mb-4 border-b border-slate-200 bg-snow-50/95 px-4 pb-2 pt-[max(0.75rem,var(--safe-top))] shadow-sm backdrop-blur print:hidden"
          data-share-export-ignore="true"
        >
          <div className="mb-2 hidden md:block">{bar}</div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold tracking-wide text-ice-700">{t('shareReadOnly')}</p>
              <h1 className="text-lg font-bold leading-snug text-slate-900">{pageHeading(locale)}</h1>
            </div>
            <LanguageMenu tone="light" onPick={pickLang} />
          </div>
          {trip && (
            <nav aria-label={t('dayNav')} className="mt-2 flex gap-1 overflow-x-auto no-scrollbar pb-1">
              <button
                type="button"
                className={`${chipClass(scope.kind === 'all')} inline-flex items-center`}
                aria-pressed={scope.kind === 'all'}
                onClick={() => selectScope({ kind: 'all' })}
              >
                {t('shareWhole')}
              </button>
              {trip.days.map((day) => {
                const active = scope.kind === 'day' && scope.day === day.day;
                const heading = shareDayHeading(locale, day);
                return (
                  <button
                    key={day.day}
                    type="button"
                    className={chipClass(active)}
                    aria-pressed={active}
                    onClick={() => selectScope({ kind: 'day', day: day.day })}
                  >
                    <span className="block leading-tight">{heading.title}</span>
                    <span className="block text-xs font-medium opacity-80">{day.date.slice(5)}</span>
                  </button>
                );
              })}
            </nav>
          )}
        </div>

        {!trip && !failed && (
          <p className="px-1 py-16 text-center text-base font-semibold text-ice-700">{t('loadingTrip')}</p>
        )}
        {failed && (
          <p className="px-1 py-16 text-center text-base font-semibold text-slate-700" role="alert">
            {t('shareLoadFailed')}
          </p>
        )}

        {trip && (
          <div ref={exportRootRef} data-share-export-root="true" className="share-export-root bg-snow-50">
            <header className="share-mast">
              <p className="share-print-title hidden text-[1.35rem] font-bold leading-tight text-slate-900 print:block">
                {pageHeading(locale)}
              </p>
              <p className="text-sm leading-relaxed text-slate-600 print:hidden">{t('shareGuest')}</p>
              <a href="/" className="mt-1 inline-flex min-h-touch items-center text-sm font-semibold text-ice-700 print:hidden">
                {t('shareBack')}
              </a>
              {subtitle && <p className="mt-3 text-sm font-medium text-slate-700 print:mt-1 print:text-black">{subtitle}</p>}
              <section className="share-lodging mt-4 rounded-2xl border border-ice-100 bg-white px-4 py-3 print:mt-3 print:rounded-none print:border-0 print:border-b print:border-slate-300 print:bg-transparent print:px-0 print:py-2">
                <h2 className="text-sm font-bold text-ice-700 print:text-black">{t('shareStayBase')}</h2>
                {lodging.name && <p className="mt-1 text-base font-semibold leading-snug text-slate-900">{lodging.name}</p>}
                {lodging.address && <p className="mt-0.5 text-sm leading-relaxed text-slate-600 print:text-black">{lodging.address}</p>}
                <p className="mt-1 text-sm text-slate-500 print:text-black">
                  <span className="font-medium">{t('shareCoords')}</span> {formatLodgingPoint(lodging.point)}
                </p>
                {lodging.usedBaseFallback && (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600 print:text-black">{t('shareBaseFallback')}</p>
                )}
              </section>
            </header>

            {viewed.unknownDay && (
              <p className="mt-6 text-base text-slate-700" role="status">
                {t('dayNotInTrip')}
              </p>
            )}

            {viewed.days.map((block) => {
              const heading = shareDayHeading(locale, block.day);
              return (
                <section key={block.day.day} className="share-day mt-8 print:mt-4" aria-labelledby={`share-day-${block.day.day}`}>
                  <header className="share-day-head border-b-2 border-ice-600 pb-2 print:border-black">
                    <div className="flex items-baseline justify-between gap-3">
                      <h2 id={`share-day-${block.day.day}`} className="text-xl font-bold leading-tight text-slate-900">
                        {heading.title}
                      </h2>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-600 print:text-black">{heading.dateLabel}</p>
                    </div>
                    {lodging.name && (
                      <p className="share-day-stay mt-1 hidden text-sm">{t('lodgingLine', { name: lodging.name })}</p>
                    )}
                  </header>
                  {block.stops.length === 0 ? (
                    <p className="py-4 text-base text-slate-600">{t('noStopsToday')}</p>
                  ) : (
                    <ol className="share-stops">
                      {block.stops.map((row, index) => {
                        const shown = shareStopDisplay(locale, row.stop, row.number);
                        const continued = index < block.stops.length - 1;
                        return (
                          <li key={row.stop.id} className="share-stop flex items-stretch gap-3">
                            <div className="flex w-8 shrink-0 flex-col items-center self-stretch">
                              <span
                                className={`w-0 shrink-0 border-l-2 ${index > 0 ? 'h-3 border-ice-300 print:border-slate-500' : 'h-3 border-transparent'}`}
                                aria-hidden
                              />
                              <span className="z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ice-700 bg-white text-sm font-bold text-ice-700 print:border-black print:text-black">
                                {shown.number}
                              </span>
                              <span
                                className={`w-0 flex-1 border-l-2 ${continued ? 'border-ice-300 print:border-slate-500' : 'border-transparent'}`}
                                aria-hidden
                              />
                            </div>
                            <div className="min-w-0 flex-1 border-b border-slate-200 py-3 print:border-slate-300">
                              <p className="text-sm font-semibold tabular-nums text-slate-500 print:text-black">
                                {shown.time || t('timeUnset')}
                              </p>
                              <h3 className="share-stop-title text-base font-bold leading-snug text-slate-900">{shown.title}</h3>
                              {shown.notes && (
                                <p className="share-notes mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-600 print:text-[10.5pt] print:leading-snug print:text-black">
                                  {shown.notes}
                                </p>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>

      <div
        className="share-actionbar share-export-ignore fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-3 pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur print:hidden md:hidden"
        style={{ paddingBottom: 'max(0.5rem, var(--safe-bottom))' }}
        data-share-export-ignore="true"
      >
        <ShareExportBar
          canExport={Boolean(trip)}
          busy={busy}
          placement="bottom"
          onCopy={() => void onCopy()}
          onImage={() => void onImage()}
          onPdf={onPdf}
        />
      </div>
      {readyFile && (
        <div
          className="share-export-ignore print:hidden fixed left-1/2 z-40 w-[min(100%-1.5rem,36rem)] -translate-x-1/2 bottom-[calc(5.75rem+var(--safe-bottom))] md:bottom-6"
          data-share-export-ignore="true"
        >
          <button
            type="button"
            className="min-h-touch w-full rounded-xl bg-ice-700 px-4 text-sm font-bold text-white shadow-lg"
            onClick={() => {
              if (!readyFile) return;
              void handoffImage(readyFile);
            }}
          >
            {t('shareImageReady')}
          </button>
        </div>
      )}
      <ShareNotice message={notice} lift />
    </div>
  );
}
