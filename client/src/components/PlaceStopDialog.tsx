import { FormEvent, useEffect, useRef, useState } from 'react';
import { loadGoogleMaps } from '../lib/googleLoader';

export type PickedPlace = {
  title: string;
  lat: number;
  lng: number;
  address: string;
};

type Props = {
  open: boolean;
  mode: 'add' | 'edit';
  initialTitle: string;
  token: string | null;
  onClose: () => void;
  onConfirm: (place: PickedPlace) => void;
};

export function PlaceStopDialog({ open, mode, initialTitle, token, onClose, onConfirm }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialTitle);
  const [title, setTitle] = useState(initialTitle);
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState<number | null>(null);
  const [lng, setLng] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [suggestState, setSuggestState] = useState<'loading' | 'ready' | 'off'>('loading');

  useEffect(() => {
    if (!open) return;
    setQuery(initialTitle);
    setTitle(initialTitle);
    setAddress('');
    setLat(null);
    setLng(null);
    setError(null);
    setSuggestState('loading');
  }, [open, initialTitle]);

  useEffect(() => {
    if (!open) return;
    let removeListener: (() => void) | null = null;
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !inputRef.current) return;
        const bounds = new g.maps.LatLngBounds(
          { lat: 41.3, lng: 139.4 },
          { lat: 45.6, lng: 145.8 },
        );
        if (!g.maps.places?.Autocomplete) {
          setSuggestState('off');
          inputRef.current.focus();
          return;
        }
        const autocomplete = new g.maps.places.Autocomplete(inputRef.current, {
          fields: ['geometry', 'name', 'formatted_address'],
          componentRestrictions: { country: 'jp' },
          bounds,
          strictBounds: false,
        });
        const listener = autocomplete.addListener('place_changed', () => {
          const place = autocomplete.getPlace();
          const loc = place.geometry?.location;
          if (!loc) {
            setError('請從建議清單選一個地點，或按「伺服器搜尋」');
            return;
          }
          const name = place.name || inputRef.current?.value || '新站點';
          setTitle(name);
          setQuery(name);
          setAddress(place.formatted_address || '');
          setLat(loc.lat());
          setLng(loc.lng());
          setError(null);
        });
        removeListener = () => listener.remove();
        setSuggestState('ready');
        inputRef.current.focus();
      })
      .catch(() => {
        if (cancelled) return;
        setSuggestState('off');
        inputRef.current?.focus();
      });
    return () => {
      cancelled = true;
      removeListener?.();
    };
  }, [open]);

  if (!open) return null;

  function applyPlace(place: { name?: string; address?: string; lat: number; lng: number }) {
    const name = place.name || query || '新站點';
    setTitle(name);
    setQuery(name);
    setAddress(place.address || '');
    setLat(place.lat);
    setLng(place.lng);
    setError(null);
  }

  async function searchServer() {
    const q = query.trim();
    if (!q) {
      setError('請輸入地點');
      return;
    }
    if (!token) {
      setError('請先登入');
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(`/api/places?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === 'string' ? data.error : '找不到地點');
        return;
      }
      applyPlace({ name: data.name, address: data.address, lat: Number(data.lat), lng: Number(data.lng) });
    } catch {
      setError('地點查詢失敗');
    } finally {
      setSearching(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (lat == null || lng == null) {
      void searchServer();
      return;
    }
    onConfirm({
      title: title.trim() || query.trim() || '新站點',
      lat,
      lng,
      address,
    });
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="place-dialog-title"
    >
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
      >
        <h2 id="place-dialog-title" className="text-lg font-bold text-ice-800">
          {mode === 'add' ? '加入站點' : '更改地點'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {suggestState === 'ready'
            ? '輸入後從 Google 建議選取，座標會跟著地點走。也可按「伺服器搜尋」。'
            : suggestState === 'off'
              ? '瀏覽器地點建議無法使用。輸入店名或地址後按「伺服器搜尋」。'
              : '正在準備地點建議…沒有建議時可按「伺服器搜尋」。'}
        </p>
        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="place-query">
          搜尋地點
        </label>
        <input
          id="place-query"
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
          placeholder="例如 札幌市時計台"
          autoComplete="off"
        />
        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="place-title">
          站點名稱
        </label>
        <input
          id="place-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
        />
        {lat != null && lng != null && (
          <p className="mt-2 text-xs leading-snug text-slate-500">
            {address && <span className="block">{address}</span>}
            <span>
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </span>
          </p>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            className="min-h-touch flex-1 rounded-xl border border-slate-200 text-slate-700"
            onClick={() => void searchServer()}
            disabled={searching}
          >
            {searching ? '搜尋中…' : '伺服器搜尋'}
          </button>
          <button
            type="submit"
            className="min-h-touch flex-1 rounded-xl bg-ice-600 font-semibold text-white disabled:opacity-50"
            disabled={searching || (lat == null && !query.trim())}
          >
            {lat == null ? '搜尋並使用' : mode === 'add' ? '加入' : '更新'}
          </button>
        </div>
        <button type="button" className="mt-2 min-h-touch w-full rounded-xl text-slate-600" onClick={onClose}>
          取消
        </button>
      </form>
    </div>
  );
}
