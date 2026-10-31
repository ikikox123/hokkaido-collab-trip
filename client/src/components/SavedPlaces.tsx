import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { localizeError } from '../i18n/errors';
import type { MessageKey } from '../i18n/messages.ts';
import {
  areaLine,
  deleteSaved,
  groupByArea,
  listSaved,
  patchSaved,
  reextractSaved,
  shareSaved,
  type PlaceType,
  type SavedPlace,
  type SavedScope,
} from '../lib/saved';
import { SavedSheet } from './SavedSheet';

export const TYPE_LABEL: Record<PlaceType, MessageKey> = {
  eat: 'savedTypeEat',
  sight: 'savedTypeSight',
  stay: 'savedTypeStay',
  shop: 'savedTypeShop',
};
const TYPE_TONE: Record<PlaceType | 'none', string> = {
  eat: 'bg-crab-100',
  sight: 'bg-bluebell-100',
  stay: 'bg-lavender-100',
  shop: 'bg-butter-100',
  none: 'bg-slate-100',
};

function TypeIcon({ type }: { type: PlaceType | null }) {
  const common = { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true };
  if (type === 'eat') return <svg {...common}><path d="M7 3v8M4 3v5a3 3 0 0 0 6 0V3M7 11v10M17 3c-2 2-3 5-3 8h3v10" /></svg>;
  if (type === 'sight') return <svg {...common}><path d="M3 19l6-10 4 6 2-3 6 7z" /><circle cx="17" cy="6" r="1.6" /></svg>;
  if (type === 'stay') return <svg {...common}><path d="M3 18v-8M3 14h18v4M21 14v-2a3 3 0 0 0-3-3h-7v5" /><circle cx="7" cy="11" r="1.6" /></svg>;
  if (type === 'shop') return <svg {...common}><path d="M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2" /></svg>;
  return <svg {...common}><path d="M12 21s-6-6.2-6-11a6 6 0 0 1 12 0c0 4.8-6 11-6 11z" /><circle cx="12" cy="10" r="2" /></svg>;
}

function IconButton({ label, onClick, children, tone = '' }: { label: string; onClick: () => void; children: ReactNode; tone?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`btn btn-icon cute-press shrink-0 ${tone}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

type CardProps = {
  place: SavedPlace;
  index: number;
  mode: 'browse' | 'pick';
  canShare: boolean;
  busyId: string | null;
  day: number;
  onShare: (place: SavedPlace) => void;
  onDelete: (place: SavedPlace) => void;
  onRerun: (place: SavedPlace) => void;
  onEdit: (place: SavedPlace) => void;
  onPick: (place: SavedPlace) => void;
};

function PlaceCard({ place, index, mode, canShare, busyId, day, onShare, onDelete, onRerun, onEdit, onPick }: CardProps) {
  const { t } = useI18n();
  const area = areaLine(place);
  const busy = busyId === place.id;
  const shared = place.scope === 'shared';
  const located = place.lat != null && place.lng != null;
  return (
    <li
      className="saved-card flex w-[85%] max-w-[20rem] shrink-0 sm:w-[17.5rem] snap-start flex-col rounded-2xl border-2 border-ink bg-white p-3 shadow-sticker-sm"
      style={{ '--i': Math.min(index, 8) } as CSSProperties}
      data-pending={place.status === 'pending' || undefined}
      onClick={mode === 'pick' ? (event) => { if (!(event.target as HTMLElement).closest('a,button')) onPick(place); } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-bold text-ink ${TYPE_TONE[place.type ?? 'none']}`}>
          <TypeIcon type={place.type} />
          {t(place.type ? TYPE_LABEL[place.type] : 'savedTypeUnknown')}
        </span>
        {place.status === 'pending' && (
          <span className="saved-pending inline-flex items-center gap-1 rounded-full border-2 border-dashed border-ink bg-butter-100 px-2 py-0.5 text-[11px] font-bold text-ink">
            <span className="h-1.5 w-1.5 rounded-circle bg-crab-500" aria-hidden />
            {t('savedPending')}
          </span>
        )}
      </div>
      <h4 className="mt-2 line-clamp-2 min-h-[2.75rem] text-[17px] font-bold leading-snug text-ink">{place.name}</h4>
      <p className="mt-0.5 min-h-[1.25rem] truncate text-sm text-slate-600">
        {area || (shared && place.addedBy ? t('savedAddedBy', { name: place.addedBy }) : ' ')}
      </p>
      {area && shared && place.addedBy && <p className="truncate text-xs text-slate-500">{t('savedAddedBy', { name: place.addedBy })}</p>}
      {shared && place.alsoSavedBy && place.alsoSavedBy.length > 0 && (
        <p className="saved-also truncate text-xs text-slate-500">{t('savedAlsoSaved', { names: place.alsoSavedBy.join('、') })}</p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] font-semibold">
        {place.sourceUrl && (
          <a href={place.sourceUrl} target="_blank" rel="noopener noreferrer" className="saved-link inline-flex min-h-touch items-center text-ice-600 underline decoration-2 underline-offset-2">
            {t('savedSource')}
          </a>
        )}
        <a href={place.mapsUrl} target="_blank" rel="noopener noreferrer" className="saved-link inline-flex min-h-touch items-center text-ice-600 underline decoration-2 underline-offset-2">
          {t('savedGoogleMap')}
        </a>
      </div>

      {mode === 'pick' ? (
        <div className="mt-auto pt-3">
          {!located && <p className="mb-2 text-xs leading-snug text-slate-500">{t('savedPickNoCoords')}</p>}
          <button
            type="button"
            onClick={() => onPick(place)}
            className="btn btn-primary cute-pop w-full"
          >
            {t('savedPickAdd', { day })}
          </button>
        </div>
      ) : (
        <div className="mt-auto flex items-center gap-1.5 pt-3">
          {!shared && canShare && place.sharedToTrip ? (
            <span className="saved-shared-mark flex min-h-touch min-w-0 flex-1 items-center justify-center truncate rounded-full border-2 border-dashed border-ink/50 bg-mint-100 px-2 text-sm font-bold text-ink/70">
              {t('savedSharedMark')}
            </span>
          ) : !shared && canShare ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onShare(place)}
              className="btn btn-primary cute-pop min-w-0 flex-1 truncate !px-2 disabled:opacity-50"
            >
              {t('savedShare')}
            </button>
          ) : (
            <span className="flex-1" />
          )}
          {!shared && (
            <IconButton label={t('savedRerun')} onClick={() => onRerun(place)}>
              <path d="M20 12a8 8 0 1 1-2.5-5.8M20 4v4h-4" />
            </IconButton>
          )}
          {(!shared || place.mine) && (
          <IconButton label={place.status === 'pending' ? t('savedEditTitle') : t('edit')} onClick={() => onEdit(place)} tone={place.status === 'pending' ? 'bg-butter-100' : ''}>
            <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />
          </IconButton>
          )}
          {(!shared || place.mine) && (
          <IconButton label={t('delete')} onClick={() => onDelete(place)}>
            <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />
          </IconButton>
          )}
        </div>
      )}
    </li>
  );
}

type SheetState = { kind: 'rerun' | 'edit'; place: SavedPlace } | null;

type Props = {
  open: boolean;
  onClose: () => void;
  token: string;
  mode: 'browse' | 'pick';
  /** Trip companions may share to the trip and read the shared list. */
  canShare: boolean;
  /** Day number used on the pick button. */
  day?: number;
  onPick?: (place: SavedPlace) => void;
};

/** Full-screen list of saved places, grouped by city and district; each group scrolls sideways with snap. */
export function SavedPlaces({ open, onClose, token, mode, canShare, day = 1, onPick }: Props) {
  const { t } = useI18n();
  const [scope, setScope] = useState<SavedScope>('mine');
  const [lists, setLists] = useState<Record<SavedScope, SavedPlace[] | null>>({ mine: null, shared: null });
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [note, setNote] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const noteTimer = useRef<number>();

  const flash = useCallback((message: string) => {
    setNote(message);
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote(null), 2400);
  }, []);

  const load = useCallback(
    async (which: SavedScope) => {
      const result = await listSaved(token, which);
      if (result?.ok) {
        setLists((current) => ({ ...current, [which]: result.data.places }));
        setError(null);
      } else {
        setLists((current) => ({ ...current, [which]: current[which] ?? [] }));
        setError(result && !result.ok ? result.error : t('savedLoadFailed'));
      }
    },
    [token, t],
  );

  useEffect(() => {
    if (!open) return;
    setScope('mine');
    setLists({ mine: null, shared: null });
    void load('mine');
    if (canShare) void load('shared');
  }, [open, canShare, load]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sheet) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, sheet]);

  if (!open) return null;

  const places = lists[scope];
  const groups = places ? groupByArea(places) : [];
  const sharedAvailable = canShare;

  function replace(updated: SavedPlace) {
    setLists((current) => ({
      ...current,
      [updated.scope === 'shared' ? 'shared' : 'mine']: (current[updated.scope === 'shared' ? 'shared' : 'mine'] ?? []).map((p) => (p.id === updated.id ? updated : p)),
    }));
  }

  async function share(place: SavedPlace) {
    setBusyId(place.id);
    const result = await shareSaved(token, place.id);
    setBusyId(null);
    if (result?.ok) {
      flash(result.data.duplicate ? t('savedShareDuplicate') : t('savedShareDone'));
      setLists((current) => ({ ...current, mine: (current.mine ?? []).map((p) => (p.id === place.id ? { ...p, sharedToTrip: true } : p)) }));
      void load('shared');
    } else flash(localizeError(result && !result.ok ? result.error : t('savedLoadFailed'), t));
  }

  async function remove(place: SavedPlace) {
    if (!window.confirm(t('savedDeleteConfirm', { name: place.name }))) return;
    setBusyId(place.id);
    const result = await deleteSaved(token, place.id);
    setBusyId(null);
    if (result?.ok) {
      const which = place.scope === 'shared' ? 'shared' : 'mine';
      setLists((current) => ({ ...current, [which]: (current[which] ?? []).filter((p) => p.id !== place.id) }));
      flash(t('savedDeleted'));
    } else flash(localizeError(result && !result.ok ? result.error : t('savedLoadFailed'), t));
  }

  const tabs: [SavedScope, string][] = [['mine', t('savedTabMine')], ...(sharedAvailable ? ([['shared', t('savedTabShared')]] as [SavedScope, string][]) : [])];

  return (
    <div className="saved-layer fixed inset-0 z-[2000] flex items-end justify-center md:items-center md:p-6" data-share-export-ignore="true">
      <div className="menu-backdrop absolute inset-0 hidden md:block" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="saved-title"
        className="saved-panel relative flex h-[100dvh] w-full flex-col overflow-hidden bg-snow-50 pt-[var(--safe-top)] text-ink outline-none md:h-[min(46rem,90dvh)] md:max-w-3xl md:rounded-3xl md:border-2 md:border-ink md:pt-0 md:shadow-sticker"
      >
        <header className="flex shrink-0 items-start justify-between gap-3 px-4 pb-2 pt-3">
          <div className="min-w-0">
            <h2 id="saved-title" className="text-xl font-bold leading-tight">
              {mode === 'pick' ? t('savedPickTitle') : t('savedTitle')}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{scope === 'shared' ? t('savedSharedNote') : t('savedPrivateNote')}</p>
          </div>
          <button
            type="button"
            className="btn btn-icon cute-press shrink-0"
            aria-label={t('close')}
            onClick={onClose}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        {tabs.length > 1 && (
          <div className="shrink-0 px-4 pb-2">
            <div
              className="relative grid gap-1 rounded-full border-2 border-ink bg-white p-1"
              style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`, '--tab-count': tabs.length, '--tab-index': scope === 'shared' ? 1 : 0, '--tab-gap': '0.25rem' } as CSSProperties}
              role="group"
            >
              <span className="pointer-events-none absolute inset-1" aria-hidden>
                <span className="tab-slider rounded-full border-2 border-ink bg-lavender-300" />
              </span>
              {tabs.map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={scope === id}
                  onClick={() => setScope(id)}
                  className="cute-press relative min-h-touch rounded-full px-2 text-[15px] font-bold text-ink"
                >
                  {label}
                  {lists[id] && lists[id]!.length > 0 && <span className="ml-1.5 text-xs font-semibold text-slate-500">{lists[id]!.length}</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="saved-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1.5rem,var(--safe-bottom))] pt-1">
          {error && <p className="mb-2 text-sm text-red-600">{localizeError(error, t)}</p>}
          {places === null && (
            <div className="space-y-3 pt-2" aria-hidden>
              {[0, 1].map((i) => (
                <div key={i} className="saved-skeleton h-36 w-[17.5rem] rounded-2xl border-2 border-ink/30 bg-slate-100" />
              ))}
            </div>
          )}
          {places && places.length === 0 && (
            <div className="saved-empty mx-auto mt-6 max-w-xs rounded-2xl border-2 border-dashed border-ink/40 p-5 text-center">
              <svg className="mx-auto text-slate-400" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6 3h12v18l-6-4-6 4z" />
              </svg>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{scope === 'shared' ? t('savedEmptyShared') : t('savedEmptyMine')}</p>
            </div>
          )}
          {groups.map((group, g) => (
            <section key={group.key || 'none'} className="saved-group mt-4 first:mt-1" aria-label={group.label ?? t('savedNoArea')} style={{ '--g': g } as CSSProperties}>
              <div className="mb-2 flex items-baseline gap-2">
                <h3 className="text-base font-bold">{group.label ?? t('savedNoArea')}</h3>
                <span className="text-xs font-semibold text-slate-500">{t('savedGroupCount', { count: group.places.length })}</span>
              </div>
              <ul className="saved-rail -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain scroll-px-4 px-4 pb-3 pt-1" tabIndex={0} aria-label={group.label ?? t('savedNoArea')}>
                {group.places.map((place, i) => (
                  <PlaceCard
                    key={place.id}
                    place={place}
                    index={i}
                    mode={mode}
                    canShare={canShare}
                    busyId={busyId}
                    day={day}
                    onShare={(p) => void share(p)}
                    onDelete={(p) => void remove(p)}
                    onRerun={(p) => setSheet({ kind: 'rerun', place: p })}
                    onEdit={(p) => setSheet({ kind: 'edit', place: p })}
                    onPick={(p) => onPick?.(p)}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>

        {note && (
          <div role="status" className="cute-enter pointer-events-none absolute inset-x-0 bottom-[max(1rem,var(--safe-bottom))] z-10 flex justify-center px-4">
            <span className="rounded-full border-2 border-ink bg-butter-100 px-4 py-2 text-sm font-bold text-ink shadow-sticker">{note}</span>
          </div>
        )}
      </div>

      {sheet?.kind === 'rerun' && (
        <RerunSheet
          token={token}
          place={sheet.place}
          onClose={() => setSheet(null)}
          onDone={(updated) => {
            replace(updated);
            setSheet(null);
            flash(t('savedRerunDone'));
          }}
        />
      )}
      {sheet?.kind === 'edit' && (
        <EditSheet
          token={token}
          place={sheet.place}
          onClose={() => setSheet(null)}
          onDone={(updated) => {
            replace(updated);
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}

function RerunSheet({ token, place, onClose, onDone }: { token: string; place: SavedPlace; onClose: () => void; onDone: (place: SavedPlace) => void }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <SavedSheet title={t('savedRerunTitle')} onClose={onClose} closeLabel={t('close')}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          const result = await reextractSaved(token, place.id, text.trim() || undefined);
          setBusy(false);
          if (result?.ok) onDone(result.data.place);
          else setError(result && !result.ok ? result.error : t('savedLoadFailed'));
        }}
      >
        <p className="text-sm font-semibold">{place.name}</p>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">{t('savedRerunHint')}</p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          rows={5}
          placeholder={t('savedRerunPlaceholder')}
          className="mt-3 w-full rounded-xl border-2 border-ink bg-white p-3 text-base text-ink placeholder:text-slate-400"
        />
        {error && <p className="mt-2 text-sm text-red-600">{localizeError(error, t)}</p>}
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary cute-pop mt-3 w-full disabled:opacity-50"
        >
          {busy ? t('savedRerunWorking') : t('savedRerunGo')}
        </button>
      </form>
    </SavedSheet>
  );
}

function EditSheet({ token, place, onClose, onDone }: { token: string; place: SavedPlace; onClose: () => void; onDone: (place: SavedPlace) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(place.name);
  const [city, setCity] = useState(place.city);
  const [district, setDistrict] = useState(place.district);
  const [type, setType] = useState<PlaceType | ''>(place.type ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = 'mt-1 w-full min-h-touch rounded-xl border-2 border-ink bg-white px-3 text-base text-ink';
  return (
    <SavedSheet title={t('savedEditTitle')} onClose={onClose} closeLabel={t('close')}>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          const result = await patchSaved(token, place.id, { name, city, district, type: type || null });
          setBusy(false);
          if (result?.ok) onDone(result.data.place);
          else setError(result && !result.ok ? result.error : t('savedLoadFailed'));
        }}
        className="space-y-3"
      >
        <label className="block text-sm font-semibold">
          {t('savedFieldName')}
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={field} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm font-semibold">
            {t('savedFieldCity')}
            <input value={city} onChange={(e) => setCity(e.target.value)} maxLength={40} className={field} />
          </label>
          <label className="block text-sm font-semibold">
            {t('savedFieldDistrict')}
            <input value={district} onChange={(e) => setDistrict(e.target.value)} maxLength={40} className={field} />
          </label>
        </div>
        <label className="block text-sm font-semibold">
          {t('savedFieldType')}
          <select value={type} onChange={(e) => setType(e.target.value as PlaceType | '')} className={field}>
            <option value="">{t('savedTypeUnknown')}</option>
            {(Object.keys(TYPE_LABEL) as PlaceType[]).map((id) => (
              <option key={id} value={id}>
                {t(TYPE_LABEL[id])}
              </option>
            ))}
          </select>
        </label>
        {error && <p className="text-sm text-red-600">{localizeError(error, t)}</p>}
        <button
          type="submit"
          disabled={busy}
          className="btn btn-primary cute-pop w-full disabled:opacity-50"
        >
          {t('savedSaveConfirm')}
        </button>
      </form>
    </SavedSheet>
  );
}
