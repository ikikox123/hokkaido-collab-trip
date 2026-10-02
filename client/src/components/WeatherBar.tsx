import { useEffect, useState } from 'react';
import type { WeatherCity } from '../types/trip';
import { weatherLabel } from '../lib/weather';

export function WeatherBar() {
  const [cities, setCities] = useState<WeatherCity[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/weather');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '天氣失敗');
        if (!cancelled) {
          setCities(data.cities || []);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '天氣失敗');
      }
    };
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar px-3 py-2 bg-ice-700/95 text-white text-sm">
      {error && <span className="opacity-80 shrink-0">天氣暫時無法更新</span>}
      {!error && cities.length === 0 && <span className="opacity-70 shrink-0">載入天氣…</span>}
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
    </div>
  );
}
