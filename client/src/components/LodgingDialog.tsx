import { FormEvent, useEffect, useState } from 'react';
import { localizeError } from '../i18n/errors';
import { useI18n } from '../i18n/I18nProvider';
import type { Lodging, Stop } from '../types/trip';

export type LodgingDraft = {
  name: string;
  address: string;
  lat: number;
  lng: number;
};

type Props = {
  open: boolean;
  lodging?: Lodging | null;
  stops: Stop[];
  token: string | null;
  onClose: () => void;
  onSave: (lodging: LodgingDraft) => Promise<{ ok: boolean; error?: string }>;
};

export function LodgingDialog({ open, lodging, stops, token, onClose, onSave }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [stopId, setStopId] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(lodging?.name || '');
    setAddress(lodging?.address || '');
    setLat(Number.isFinite(lodging?.lat) ? String(lodging?.lat) : '');
    setLng(Number.isFinite(lodging?.lng) ? String(lodging?.lng) : '');
    setStopId('');
    setQuery('');
    setError(null);
    setSaving(false);
    setSearching(false);
  }, [open, lodging]);

  if (!open) return null;

  function fillFromStop() {
    const stop = stops.find((item) => item.id === stopId);
    if (!stop) {
      setError('請先選擇一個站點');
      return;
    }
    setName(stop.title);
    setAddress(stop.notes || '');
    setLat(String(stop.lat));
    setLng(String(stop.lng));
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
      if (typeof data.name === 'string' && data.name.trim()) setName(data.name.trim());
      setAddress(typeof data.address === 'string' ? data.address : '');
      setLat(String(data.lat ?? ''));
      setLng(String(data.lng ?? ''));
    } catch {
      setError('地點查詢失敗');
    } finally {
      setSearching(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextName = name.trim();
    if (!nextName) {
      setError('住宿名稱不可空白');
      return;
    }
    if (nextName.length > 80) {
      setError('住宿名稱過長');
      return;
    }
    const nextAddress = address.trim();
    if (nextAddress.length > 160) {
      setError('住宿地址過長');
      return;
    }
    const nextLat = Number(lat);
    const nextLng = Number(lng);
    if (!lat.trim() || !lng.trim() || !Number.isFinite(nextLat) || !Number.isFinite(nextLng)) {
      setError('座標不完整');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await onSave({
        name: nextName,
        address: nextAddress,
        lat: nextLat,
        lng: nextLng,
      });
      if (!result.ok) setError(result.error || '無法更新');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="lodging-dialog-title"
    >
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl"
      >
        <h2 id="lodging-dialog-title" className="text-lg font-bold text-ice-800">
          {t('lodgingDialogTitle')}
        </h2>
        <p className="mt-1 text-sm text-slate-500">{t('lodgingHint')}</p>

        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="lodging-stop">
          {t('lodgingPickStop')}
        </label>
        <div className="mt-1 flex gap-2">
          <select
            id="lodging-stop"
            value={stopId}
            onChange={(e) => setStopId(e.target.value)}
            className="min-h-touch min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-base"
          >
            <option value="">{t('lodgingPickStop')}</option>
            {stops.map((stop) => (
              <option key={stop.id} value={stop.id}>
                {`D${stop.day} ${stop.time ? `${stop.time} ` : ''}${stop.title}`}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="min-h-touch shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-ice-700"
            onClick={fillFromStop}
          >
            {t('lodgingFromStop')}
          </button>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="lodging-query">
          {t('searchPlace')}
        </label>
        <div className="mt-1 flex gap-2">
          <input
            id="lodging-query"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-touch min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
            placeholder={t('placeExample')}
            autoComplete="off"
          />
          <button
            type="button"
            className="min-h-touch shrink-0 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-700 disabled:opacity-50"
            onClick={() => void searchServer()}
            disabled={searching || saving}
          >
            {searching ? t('searching') : t('serverSearch')}
          </button>
        </div>

        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="lodging-name">
          {t('lodgingName')}
        </label>
        <input
          id="lodging-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
          autoComplete="off"
        />

        <label className="mt-3 block text-sm font-medium text-slate-700" htmlFor="lodging-address">
          {t('lodgingAddress')}
        </label>
        <input
          id="lodging-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
          autoComplete="off"
        />

        <div className="mt-3 grid grid-cols-2 gap-2">
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="lodging-lat">
              {t('lodgingLat')}
            </label>
            <input
              id="lodging-lat"
              value={lat}
              inputMode="decimal"
              onChange={(e) => setLat(e.target.value)}
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              autoComplete="off"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700" htmlFor="lodging-lng">
              {t('lodgingLng')}
            </label>
            <input
              id="lodging-lng"
              value={lng}
              inputMode="decimal"
              onChange={(e) => setLng(e.target.value)}
              className="mt-1 w-full min-h-touch rounded-xl border border-slate-200 px-3 text-base outline-none focus:border-ice-500 focus:ring-2 focus:ring-ice-500/30"
              autoComplete="off"
            />
          </div>
        </div>

        {error && <p className="mt-2 text-sm text-red-600">{localizeError(error, t)}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="min-h-touch flex-1 rounded-xl border border-slate-200 text-slate-700"
            onClick={onClose}
            disabled={saving}
          >
            {t('cancel')}
          </button>
          <button
            type="submit"
            className="min-h-touch flex-1 rounded-xl bg-ice-600 font-semibold text-white disabled:opacity-50"
            disabled={saving || searching}
          >
            {t('save')}
          </button>
        </div>
      </form>
    </div>
  );
}
