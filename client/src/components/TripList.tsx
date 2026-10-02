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
import { useState } from 'react';
import type { Stop } from '../types/trip';

type Props = {
  stops: Stop[];
  selectedId: string | null;
  canEdit: boolean;
  onSelect: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  onUpdateTime: (id: string, time: string) => void;
};

function SortableItem({
  stop,
  index,
  isNext,
  selected,
  canEdit,
  onSelect,
  onDelete,
  onUpdateTime,
}: {
  stop: Stop;
  index: number;
  isNext: boolean;
  selected: boolean;
  canEdit: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onUpdateTime: (time: string) => void;
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

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex gap-2 items-stretch rounded-xl border bg-white p-2 shadow-sm ${
        selected ? 'border-ice-500 ring-2 ring-ice-500/30' : 'border-slate-200'
      } ${isNext ? 'bg-pink-50/60' : ''}`}
    >
      {canEdit && (
        <button
          type="button"
          className="shrink-0 flex items-center justify-center min-w-touch min-h-touch touch-none text-slate-400 active:text-ice-600 cursor-grab active:cursor-grabbing"
          aria-label="拖曳排序"
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
      <button
        type="button"
        className="flex-1 text-left min-h-touch py-1"
        onClick={onSelect}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-ice-600 w-5">{index + 1}</span>
          <span className="font-semibold text-[15px] leading-snug">{stop.title}</span>
          {isNext && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-pink-600 bg-pink-100 px-1.5 py-0.5 rounded">
              下一站
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 pl-7">
          {canEdit ? (
            <input
              type="time"
              className="rounded border border-slate-200 px-1.5 py-1 min-h-[36px] text-sm"
              value={stop.time || ''}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onUpdateTime(e.target.value)}
            />
          ) : (
            <span>{stop.time || '時間未定'}</span>
          )}
          {stop.notes && <span className="truncate max-w-[180px]">{stop.notes}</span>}
        </div>
      </button>
      {canEdit && (
        <button
          type="button"
          className="shrink-0 min-w-touch min-h-touch text-red-500 text-sm font-medium"
          aria-label="刪除"
          onClick={onDelete}
        >
          刪
        </button>
      )}
    </li>
  );
}

export function TripList({
  stops,
  selectedId,
  canEdit,
  onSelect,
  onReorder,
  onDelete,
  onAdd,
  onUpdateTime,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

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
        <h2 className="font-bold text-ice-700">行程站點</h2>
        {canEdit ? (
          <button
            type="button"
            onClick={onAdd}
            className="min-h-touch min-w-touch px-3 rounded-xl bg-ice-600 text-white text-sm font-semibold active:bg-ice-700"
          >
            ＋ 加入
          </button>
        ) : (
          <span className="text-xs text-slate-400">登入後可編輯</span>
        )}
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="flex-1 overflow-y-auto overscroll-contain px-3 py-2 space-y-2 pb-safe">
            {stops.length === 0 && (
              <li className="text-center text-slate-400 py-8 text-sm">這天尚無站點</li>
            )}
            {stops.map((stop, i) => (
              <SortableItem
                key={stop.id}
                stop={stop}
                index={i}
                isNext={i === 0}
                selected={selectedId === stop.id}
                canEdit={canEdit}
                onSelect={() => onSelect(stop.id)}
                onDelete={() => onDelete(stop.id)}
                onUpdateTime={(time) => onUpdateTime(stop.id, time)}
              />
            ))}
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
  );
}
