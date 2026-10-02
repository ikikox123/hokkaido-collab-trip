import { useEffect, useState } from 'react';
import type { WeatherCity } from '../types/trip';
import { weatherLabel } from '../lib/weather';

const SUCCESS_MS = 10 * 60 * 1000;
const BACKOFF_START_MS = 15 * 1000;
const BACKOFF_CAP_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

export function WeatherBar() {
  const [cities, setCities] = useState<WeatherCity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

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
        const res = await fetch('/api/weather', { signal: controller.signal });
        const data = await res.json().catch(() => ({}));
        if (cancelled || active !== controller) return;
        if (!res.ok) {
          const message = typeof data.error === 'string' && data.error ? data.error : '天氣失敗';
          throw new Error(message);
        }
        if (Array.isArray(data.cities) && data.cities.length > 0) {
          setCities(data.cities);
        }
        setWarning(typeof data.warning === 'string' && data.warning ? data.warning : null);
        setError(null);
        failures = 0;
        schedule(SUCCESS_MS);
      } catch (e) {
        if (cancelled || active !== controller) return;
        setError(e instanceof Error ? e.message : '天氣失敗');
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

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar px-3 py-2 bg-ice-700/95 text-white text-sm">
      {error && <span className="opacity-80 shrink-0">天氣暫時無法更新</span>}
      {!error && warning && <span className="opacity-80 shrink-0">{warning}</span>}
      {!error && !warning && cities.length === 0 && <span className="opacity-70 shrink-0">載入天氣…</span>}
      {cities.map((c) => {
        const w = weatherLabel(c.weatherCode);
        return (
          <div
            key={c.id}
            className="flex items-center gap-1.5 shrink-0 rounded-full bg-white/15 px-3 min-h-touch"
            title={c.time || ''}
          >
            <span className="font-medium">{c.name}</span>
            <span aria-hidden>{w.emoji}</span>
            <span>
              {c.temperature != null ? `${Math.round(c.temperature)}°C` : '—'}
            </span>
            <span className="text-white/70 text-xs hidden sm:inline">{w.label}</span>
          </div>
        );
      })}
      {error && (
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          className="shrink-0 rounded-full bg-white/15 px-3 min-h-touch text-xs font-medium"
        >
          重新整理
        </button>
      )}
    </div>
  );
}
