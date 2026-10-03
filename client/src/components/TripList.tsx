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
import { StopName } from './StopName';

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
      ? 'bg-sakura-500 text-white'
      : accent === 'selected'
        ? 'bg-ice-600 text-white ring-2 ring-ice-300'
        : 'bg-white text-ice-700 ring-2 ring-ice-500';
  return (
    <div className="relative flex w-8 shrink-0 flex-col items-center self-stretch" aria-hidden>
      <span className={`w-0.5 shrink-0 ${fromPrevious ? 'h-2 bg-ice-300' : 'h-2'}`} />
      <span className={`z-10 flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${dot}`}>
        {index + 1}
      </span>
      <span className={`w-0.5 flex-1 ${continued ? 'bg-ice-300' : ''}`} />
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
    <li ref={setNodeRef} style={style} className="flex items-stretch gap-1">
      <TimelineDot index={index} continued={hasNext} fromPrevious={index > 0} accent={accent} />
      <div
        className={`mb-1 flex min-w-0 flex-1 items-stretch gap-1 rounded-xl border bg-white p-1.5 shadow-sm ${
          selected ? 'border-ice-500 ring-2 ring-ice-500/30' : 'border-slate-200'
        } ${isNext ? 'bg-pink-50/80' : ''}`}
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
              <span className="shrink-0 rounded-md bg-pink-100 px-2 py-0.5 text-sm font-bold text-pink-700">
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
                className="min-h-touch rounded-lg border border-slate-200 px-2 py-1 text-base"
                value={stop.time || ''}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => onUpdateTime(e.target.value)}
              />
            ) : (
              <span className="font-medium text-slate-700">{stop.time || t('timeUnset')}</span>
            )}
            {stop.notes && <span className="min-w-0 flex-1 truncate">{stop.notes}</span>}
          </div>
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-col">
            {onEditPlace && (
              <button
                type="button"
                className="min-h-touch min-w-touch text-sm font-medium text-ice-700"
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
              className="min-h-touch min-w-touch text-sm font-medium text-red-500"
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
  const { t } = useI18n();
  const mode: TravelMode = leg?.mode && isTravelMode(leg.mode) ? leg.mode : 'walk';
  return (
    <li className="flex items-stretch gap-1" aria-label={t('toNextAria', { from: from.title, to: to.title })}>
      <div className="relative flex w-8 shrink-0 items-center justify-center self-stretch" aria-hidden>
        <span className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-ice-300" />
        <span
          className="relative z-10 h-3.5 w-3.5 rounded-full ring-2 ring-snow-50"
          style={{ background: MODE_COLORS[mode] }}
        />
      </div>
      <div className="min-w-0 flex-1 pb-2 pr-1">
        <p className="text-sm font-bold text-ice-700">{t('toNext')}</p>
        {canEdit ? (
          <select
            aria-label={t('toNextModeAria', { from: from.title, to: to.title })}
            className="mt-1 min-h-touch w-full rounded-lg border border-slate-200 bg-white px-2 text-base text-slate-800"
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
          <p className="mt-0.5 text-base font-medium text-slate-800">{travelLabel(t, mode)}</p>
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
  const { t } = useI18n();

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
        <h2 className="font-bold text-ice-700">{t('stopsTitle')}</h2>
        {canEdit ? (
          <button
            type="button"
            onClick={onAdd}
            className="min-h-touch min-w-touch px-3 rounded-xl bg-ice-600 text-white text-sm font-semibold active:bg-ice-700"
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
            <div className="drag-overlay rounded-xl border border-ice-400 bg-white p-3 font-semibold shadow-lg">
              {activeStop.title}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      </div>
    </div>
  );
}
