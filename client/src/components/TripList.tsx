import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Fragment, useState } from 'react';
import type { Leg, Stop, TravelMode } from '../types/trip';
import { useI18n } from '../i18n/I18nProvider';
import { travelLabel } from '../i18n/labels';
import { isTravelMode, MODE_COLORS, TRAVEL_MODES } from '../lib/travel';
import { displayStopTitle } from '../i18n/stopNames';
import { StopName } from './StopName';
import { SectionBadge } from './Cute';

type Props = {
  stops: Stop[];
  legs: Leg[];
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onUpdateTime: (id: string, time: string) => void;
  onRename: (id: string, title: string) => void;
  onSetMode: (fromStopId: string, toStopId: string, mode: TravelMode) => void;
  onEditPlace?: (id: string) => void;
};

function TimelineDot({
  index,
  continued,
  fromPrevious,
  accent,
}: {
  index: number;
  continued: boolean;
  fromPrevious: boolean;
  accent: 'next' | 'selected' | 'default';
}) {
  const dot =
    accent === 'next'
      ? 'bg-crab-300 shadow-sticker-sm'
      : accent === 'selected'
        ? 'bg-ice-300 shadow-sticker-sm'
        : 'bg-white';
  return (
    <div className="relative flex w-8 shrink-0 flex-col items-center self-stretch" aria-hidden>
      <span className={`h-2 shrink-0 ${fromPrevious ? 'border-l-[3px] border-dotted border-ink/70' : ''}`} />
      <span
        className={`z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink text-sm font-bold text-ink transition-colors ${dot}`}
      >
        {index + 1}
      </span>
      <span className={`flex-1 ${continued ? 'border-l-[3px] border-dotted border-ink/70' : ''}`} />
    </div>
  );
}

function SortableItem({
  stop,
  index,
  isNext,
  hasNext,
  selected,
  canEdit,
  onSelect,
  onDelete,
  onUpdateTime,
  onRename,
  onEditPlace,
}: {
  stop: Stop;
  index: number;
  isNext: boolean;
  hasNext: boolean;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdateTime: (time: string) => void;
  onRename: (title: string) => void;
  onEditPlace?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stop.id,
    disabled: !canEdit,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const { t } = useI18n();
  const accent = isNext ? 'next' : selected ? 'selected' : 'default';

  return (
    <li ref={setNodeRef} style={style} className="flex items-stretch gap-1.5">
      <TimelineDot index={index} continued={hasNext} fromPrevious={index > 0} accent={accent} />
      <div
        data-reveal
        className={`cute-pop mb-1 flex min-w-0 flex-1 items-stretch gap-1 rounded-2xl border-2 border-ink p-1.5 ${
          selected ? 'bg-bluebell-100 shadow-sticker' : 'shadow-sticker-sm'
        } ${isNext ? 'bg-crab-100' : selected ? '' : 'bg-white'}`}
      >
        {canEdit && (
          <button
            type="button"
            className="flex min-h-touch min-w-touch shrink-0 touch-none cursor-grab items-center justify-center text-slate-400 active:cursor-grabbing active:text-ice-600"
            aria-label={t('dragSort')}
            {...attributes}
            {...listeners}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <circle cx="7" cy="5" r="1.5" />
              <circle cx="13" cy="5" r="1.5" />
              <circle cx="7" cy="10" r="1.5" />
              <circle cx="13" cy="10" r="1.5" />
              <circle cx="7" cy="15" r="1.5" />
              <circle cx="13" cy="15" r="1.5" />
            </svg>
          </button>
        )}
        <div className="min-w-0 flex-1 py-1" onClick={onSelect}>
          <div className="flex items-center gap-2">
            <StopName title={stop.title} canEdit={canEdit} onRename={onRename} />
            {isNext && (
              <span className="shrink-0 rounded-full border-2 border-ink bg-crab-300 px-2 text-sm font-bold leading-6 text-ink">
                {t('nextStop')}
              </span>
            )}
          </div>
          <div
            className="mt-0.5 flex flex-wrap items-center gap-2 text-sm text-slate-600"
            onClick={(e) => e.stopPropagation()}
          >
            {canEdit ? (
              <input
                type="time"
                className="min-h-touch rounded-full border border-slate-300 bg-white px-3 py-1 text-base font-bold text-ink"
                value={stop.time || ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onUpdateTime(e.target.value)}
              />
            ) : (
              <span className="rounded-full border-2 border-ink bg-butter-100 px-2 font-bold leading-6 text-ink">
                {stop.time || t('timeUnset')}
              </span>
            )}
            {stop.notes && <span className="min-w-0 flex-1 truncate">{stop.notes}</span>}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-col">
            {onEditPlace && (
              <button
                type="button"
                className="cute-press min-h-touch min-w-touch rounded-full text-sm font-bold text-ice-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditPlace();
                }}
              >
                {t('placeButton')}
              </button>
            )}
            <button
              type="button"
              className="cute-press min-h-touch min-w-touch rounded-full text-sm font-bold text-red-600"
              aria-label={t('delete')}
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
            >
              {t('deleteShort')}
            </button>
          </div>
        )}
      </div>
    </li>
  );
}

function LegConnector({
  from,
  to,
  leg,
  canEdit,
  onSetMode,
}: {
  from: Stop;
  to: Stop;
  leg?: Leg;
  canEdit: boolean;
  onSetMode: (mode: TravelMode) => void;
}) {
  const { t, locale } = useI18n();
  const mode: TravelMode = leg?.mode && isTravelMode(leg.mode) ? leg.mode : 'walk';
  const fromName = displayStopTitle(locale, from.title);
  const toName = displayStopTitle(locale, to.title);
  return (
    <li className="flex items-stretch gap-1.5" aria-label={t('toNextAria', { from: fromName, to: toName })}>
      <div className="relative flex w-8 shrink-0 items-center justify-center self-stretch" aria-hidden>
        <span className="absolute inset-y-0 left-1/2 -translate-x-[1.5px] border-l-[3px] border-dotted border-ink/70" />
        <span
          className="relative z-10 h-3.5 w-3.5 rounded-full border-2 border-ink"
          style={{ background: MODE_COLORS[mode] }}
        />
      </div>
      <div className="min-w-0 flex-1 py-1.5 pr-1" data-reveal>
        <p className="text-xs font-bold text-slate-500">{t('toNext')}</p>
        {canEdit ? (
          <select
            aria-label={t('toNextModeAria', { from: fromName, to: toName })}
            className="mt-1 min-h-touch w-full rounded-full border border-ink px-3 text-base font-bold text-ink"
            style={{ background: `color-mix(in srgb, ${MODE_COLORS[mode]} 16%, white)` }}
            value={mode}
            onChange={(e) => {
              if (isTravelMode(e.target.value)) onSetMode(e.target.value);
            }}
          >
            {TRAVEL_MODES.map((m) => (
              <option key={m} value={m}>
                {travelLabel(t, m)}
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-0.5">
            <span
              className="inline-flex items-center rounded-full border-2 px-2.5 text-sm font-bold leading-6 text-ink"
              style={{ borderColor: MODE_COLORS[mode], background: `color-mix(in srgb, ${MODE_COLORS[mode]} 16%, white)` }}
            >
              {travelLabel(t, mode)}
            </span>
          </p>
        )}
        <p className="mt-1 text-sm leading-snug text-slate-600">{leg?.summary || t('estimating')}</p>
      </div>
    </li>
  );
}

export function TripList({
  stops,
  legs,
  selectedId,
  canEdit,
  onSelect,
  onReorder,
  onDelete,
  onAdd,
  onUpdateTime,
  onRename,
  onSetMode,
  onEditPlace,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const { t, locale } = useI18n();

  // Touch: delay so vertical scroll still works; Pointer for mouse/stylus
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
  );

  const activeStop = stops.find((s) => s.id === activeId);

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = stops.findIndex((s) => s.id === active.id);
    const newIndex = stops.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(stops, oldIndex, newIndex);
    onReorder(next.map((s) => s.id));
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <h2 className="flex items-center gap-2 text-lg font-bold text-ink">
          <SectionBadge icon="pin" />
          {t('stopsTitle')}
        </h2>
        {canEdit ? (
          <button
            type="button"
            onClick={onAdd}
            className="cute-pop min-h-touch min-w-touch rounded-full border-2 border-ink bg-lavender-300 px-4 text-sm font-bold text-ink shadow-sticker"
          >
            {t('addStopButton')}
          </button>
        ) : (
          <span className="text-sm text-slate-500">{t('loginToEditHint')}</span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 pb-safe">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul>
            {stops.length === 0 && (
              <li className="py-8 text-center text-base text-slate-500">{t('noStopsToday')}</li>
            )}
            {stops.map((stop, i) => {
              const next = stops[i + 1];
              const leg = next
                ? legs.find((l) => l.fromStopId === stop.id && l.toStopId === next.id)
                : undefined;
              return (
                <Fragment key={stop.id}>
                  <SortableItem
                    stop={stop}
                    index={i}
                    isNext={i === 0}
                    hasNext={Boolean(next)}
                    selected={selectedId === stop.id}
                    canEdit={canEdit}
                    onSelect={() => onSelect(stop.id)}
                    onDelete={() => onDelete(stop.id)}
                    onUpdateTime={(time) => onUpdateTime(stop.id, time)}
                    onRename={(title) => onRename(stop.id, title)}
                    onEditPlace={onEditPlace ? () => onEditPlace(stop.id) : undefined}
                  />
                  {next && (
                    <LegConnector
                      from={stop}
                      to={next}
                      leg={leg}
                      canEdit={canEdit}
                      onSetMode={(mode) => onSetMode(stop.id, next.id, mode)}
                    />
                  )}
                </Fragment>
              );
            })}
          </ul>
        </SortableContext>
        <DragOverlay>
          {activeStop ? (
            <div className="drag-overlay rounded-2xl border-2 border-ink bg-butter-100 p-3 font-bold text-ink">
              {displayStopTitle(locale, activeStop.title)}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      </div>
    </div>
  );
}
