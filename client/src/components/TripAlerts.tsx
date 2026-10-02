import { useEffect, useState } from 'react';
import type { WeatherCity } from '../types/trip';
import { activeWarningSummary, jrOneLiner, weatherTempLine } from '../lib/alertSummary';
import { weatherLabel } from '../lib/weather';

const SUCCESS_MS = 5 * 60 * 1000;
const BACKOFF_START_MS = 15 * 1000;
const BACKOFF_CAP_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

const NOTICE =
  '預報來自 Open-Meteo；警報來自氣象廳；tenki.jp 無公開可串接 API（需付費商業授權）。';

const JR_OFFICIAL_URL = 'https://www3.jrhokkaido.co.jp/webunkou/';

type WarningKind = {
  name: string;
  status: string;
  statusLabel: string;
  level: 'special' | 'warning' | 'advisory' | 'other' | string;
};

type WarningArea = {
  id: string;
  name: string;
  confirmed: boolean;
  active: WarningKind[];
};

type Warnings = {
  ok: boolean;
  stale?: boolean;
  partial?: boolean;
  calm?: boolean;
  areas: WarningArea[];
  headlines?: { office?: string; text: string }[];
  error?: string;
  sourceUrl?: string;
};

type JrArea = {
  id: string;
  name: string;
  status: number | null;
  label: string;
  tomorrowStatus?: number | null;
  tomorrowLabel?: string;
  href: string;
  notes?: string[];
};

type JrStatus = {
  ok: boolean;
  stale?: boolean;
  officialUrl?: string;
  officialTime?: string;
  areas: JrArea[];
  error?: string;
};

type WeatherPayload = {
  ok: boolean;
  cities?: WeatherCity[];
  warning?: string;
  stale?: boolean;
  error?: string;
};

type AlertsPayload = {
  weather: WeatherPayload;
  warnings: Warnings;
  jr: JrStatus;
  notice?: string;
};

function levelClass(level: string) {
  if (level === 'special') return 'border-red-300 bg-red-50 text-red-950';
  if (level === 'warning') return 'border-orange-300 bg-orange-50 text-orange-950';
  return 'border-amber-300 bg-amber-50 text-amber-950';
}

function jrClass(status: number | null) {
  if (status === 1) return 'border border-red-200 bg-red-50 text-red-950';
  if (status === 0) return 'border border-emerald-200 bg-emerald-50 text-emerald-950';
  return 'border border-slate-200 bg-white text-slate-800';
}

export function TripAlerts() {
  const [data, setData] = useState<AlertsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let failures = 0;
    let active: AbortController | null = null;

    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void load();
      }, ms);
    };

    const load = async () => {
      active?.abort();
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch('/api/trip-alerts', { signal: controller.signal });
        const body = (await res.json().catch(() => null)) as AlertsPayload | null;
        if (cancelled || active !== controller) return;
        if (!res.ok || !body || !body.warnings || !body.jr) {
          throw new Error('告警取得失敗');
        }
        setData(body);
        setError(null);
        failures = 0;
        schedule(SUCCESS_MS);
      } catch (err) {
        if (cancelled || active !== controller) return;
        setError(err instanceof Error ? err.message : '告警取得失敗');
        failures += 1;
        const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_START_MS * 2 ** (failures - 1));
        schedule(delay);
      } finally {
        window.clearTimeout(timeout);
      }
    };

    void load();
    return () => {
      cancelled = true;
      active?.abort();
      window.clearTimeout(timer);
    };
  }, [reloadKey]);

  const weather = data?.weather;
  const warnings = data?.warnings;
  const jr = data?.jr;
  const cities = weather?.cities ?? [];
  const activeAreas = (warnings?.areas ?? []).filter((area) => area.active.length > 0);
  const calmNames = (warnings?.areas ?? [])
    .filter((area) => area.confirmed && area.active.length === 0)
    .map((area) => area.name);
  const unknownNames = (warnings?.areas ?? []).filter((area) => !area.confirmed).map((area) => area.name);
  const jrUrl = jr?.officialUrl || JR_OFFICIAL_URL;
  const warningOn = Boolean(warnings?.ok && activeAreas.length > 0);
  const warningSummary = activeWarningSummary(activeAreas);
  const temps = weatherTempLine(cities);
  const jrLine = jrOneLiner(jr?.areas ?? [], jr?.ok);
  const needsRefresh = Boolean(error || warnings?.ok === false || jr?.ok === false || weather?.ok === false);

  return (
    <section
      aria-labelledby="trip-alerts-heading"
      className="shrink-0 border-b border-slate-200 bg-white"
    >
      <div className="flex items-stretch gap-1 px-2 py-1.5">
        <button
          type="button"
          className="flex min-h-touch min-w-0 flex-1 items-center gap-2 rounded-xl px-2 py-1 text-left active:bg-snow-100"
          aria-expanded={expanded}
          aria-controls="trip-alerts-details"
          onClick={() => setExpanded((open) => !open)}
        >
          <span className="min-w-0 flex-1">
            <span id="trip-alerts-heading" className="sr-only">
              天氣＋交通告警
            </span>
            {warningOn ? (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="font-bold text-amber-950">目前運行狀態</span>
                <span className="rounded-md bg-amber-100 px-2 py-0.5 text-sm font-bold text-amber-950">
                  有警報
                </span>
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-red-600 px-1.5 text-sm font-bold text-white">
                  {warningSummary.count}
                </span>
                <span className="min-w-0 text-sm font-medium leading-snug text-slate-800">
                  {warningSummary.label}
                </span>
              </span>
            ) : (
              <span className="block space-y-0.5">
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm leading-snug text-slate-800">
                  <span className="font-bold text-sky-800">旅程日期預報</span>
                  <span>
                    {temps ||
                      (weather?.ok === false ? weather.error || '天氣暫時無法更新' : '天氣載入中')}
                  </span>
                </span>
                <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm leading-snug text-slate-800">
                  <span className="font-bold text-amber-900">目前運行狀態</span>
                  <span>{warnings || jr ? jrLine : error ? '告警暫時無法更新' : '載入中'}</span>
                </span>
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm font-bold text-ice-700">{expanded ? '收合' : '展開'}</span>
        </button>
        {needsRefresh && (
          <button
            type="button"
            onClick={() => setReloadKey((key) => key + 1)}
            className="shrink-0 self-center rounded-full bg-snow-100 px-3 min-h-touch text-sm font-semibold text-ice-700"
          >
            重新整理
          </button>
        )}
      </div>

      {expanded && (
        <div id="trip-alerts-details" className="max-h-[42vh] space-y-3 overflow-y-auto px-3 pb-3">
          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3">
            <h3 className="text-base font-bold text-sky-950">旅程日期預報</h3>
            <p className="mt-0.5 text-sm leading-snug text-sky-900">行程參考的天氣概況（Open-Meteo）</p>
            <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
              {error && cities.length === 0 && (
                <span className="text-sm text-slate-600">天氣暫時無法更新</span>
              )}
              {!error && weather?.ok === false && (
                <span className="text-sm text-slate-600">{weather.error || '天氣暫時無法更新'}</span>
              )}
              {!error && weather?.ok !== false && cities.length === 0 && (
                <span className="text-sm text-slate-600">載入天氣…</span>
              )}
              {cities.map((city) => {
                const label = weatherLabel(city.weatherCode);
                return (
                  <div
                    key={city.id}
                    className="flex shrink-0 items-center gap-1.5 rounded-full border border-sky-200 bg-white px-3 min-h-touch text-base"
                    title={city.time || label.label}
                  >
                    <span className="font-semibold text-ice-700">{city.name}</span>
                    <span aria-hidden>{label.emoji}</span>
                    <span>{city.temperature != null ? `${Math.round(city.temperature)}°C` : '—'}</span>
                    <span className="text-sm text-slate-600">{label.label}</span>
                  </div>
                );
              })}
            </div>
            {weather?.warning && <p className="mt-2 text-sm text-slate-600">{weather.warning}</p>}
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3">
            <h3 className="text-base font-bold text-amber-950">目前運行狀態</h3>
            <p className="mt-0.5 text-sm leading-snug text-amber-950">現在的氣象廳警報與 JR 北海道</p>

            <h4 className="mt-3 text-sm font-bold text-slate-700">氣象廳警報</h4>
            {!warnings && !error && <p className="mt-1 text-sm text-slate-600">載入警報…</p>}
            {warnings?.ok === false && (
              <p className="mt-1 text-sm text-slate-700">{warnings.error || '警報暫時無法更新'}</p>
            )}
            {warnings?.stale && <p className="mt-1 text-sm text-slate-600">警報暫時使用稍早的資料</p>}
            {warnings?.ok && !warningOn && (
              <p className="mt-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-950">
                目前無警報
                {calmNames.length > 0 && (
                  <span className="mt-0.5 block font-normal text-emerald-900">{calmNames.join('、')}</span>
                )}
              </p>
            )}
            {warningOn && (
              <ul className="mt-1 space-y-1.5">
                {activeAreas.map((area) => (
                  <li
                    key={area.id}
                    className={`rounded-xl border px-3 py-2 ${levelClass(area.active[0]?.level || 'advisory')}`}
                  >
                    <p className="text-base font-semibold">{area.name}</p>
                    <ul className="mt-0.5 space-y-0.5">
                      {area.active.map((kind) => (
                        <li key={`${kind.name}-${kind.status}`} className="text-sm leading-snug">
                          <span className="text-sm text-slate-600">原文 </span>
                          {kind.name}
                          {kind.statusLabel ? (
                            <span className="ml-1 text-sm opacity-80">{kind.statusLabel}</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
                {calmNames.length > 0 && (
                  <li className="rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                    {calmNames.join('、')}目前無警報
                  </li>
                )}
                {unknownNames.length > 0 && (
                  <li className="text-sm text-slate-600">{unknownNames.join('、')}暫時無法確認</li>
                )}
              </ul>
            )}
            {warnings?.headlines?.map((headline) => (
              <p key={headline.text} className="mt-2 text-sm leading-snug text-slate-700">
                <span className="font-semibold">氣象廳原文</span>
                {headline.office ? `（${headline.office}）` : ''}：{headline.text}
              </p>
            ))}

            <h4 className="mt-3 text-sm font-bold text-slate-700">JR 北海道</h4>
            {jr?.officialTime && <p className="text-sm text-slate-600">官方更新 {jr.officialTime}</p>}
            {jr?.stale && <p className="text-sm text-slate-600">運行資訊暫時使用稍早的資料</p>}
            {!jr && !error && <p className="mt-1 text-sm text-slate-600">載入運行資訊…</p>}
            {jr?.ok === false && (
              <p className="mt-1 text-sm text-slate-700">{jr.error || '暫時無法取得運行摘要'}</p>
            )}
            {jr?.ok && (
              <ul className="mt-1 space-y-1.5">
                {jr.areas.map((area) => (
                  <li key={area.id} className={`rounded-xl px-3 py-2 ${jrClass(area.status)}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <a
                        href={area.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-base font-semibold underline-offset-2 hover:underline"
                      >
                        {area.name}
                      </a>
                      <span className="text-right text-sm leading-snug">{area.label}</span>
                    </div>
                    {area.tomorrowStatus === 1 && area.tomorrowLabel && (
                      <p className="mt-1 text-sm">明日：{area.tomorrowLabel}</p>
                    )}
                    {area.notes && area.notes.length > 0 && (
                      <div className="mt-1">
                        <p className="text-sm font-semibold">官方說明（原文）</p>
                        {area.notes.map((note) => (
                          <p key={note} className="mt-0.5 whitespace-pre-wrap text-sm leading-snug">
                            {note}
                          </p>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <a
            href={jrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-h-touch items-center justify-center rounded-xl bg-ice-600 px-3 text-center text-base font-semibold text-white active:bg-ice-700"
          >
            查看 JR北海道官方運行資訊
          </a>

          <p className="text-sm leading-snug text-slate-600">
            {data?.notice || NOTICE}
            {warnings?.sourceUrl && (
              <>
                {' '}
                <a href={warnings.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  出典：氣象廳防災資訊XML
                </a>
              </>
            )}
          </p>
          <p className="text-sm leading-snug text-slate-500">
            警報名稱依氣象廳原文摘錄行程地區，未經改寫。
          </p>
        </div>
      )}
    </section>
  );
}
