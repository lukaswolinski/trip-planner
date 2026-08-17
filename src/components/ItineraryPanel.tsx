'use client';

import { useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api } from '@/lib/client/api';
import { EmptyState, button, input } from './ui';
import TimePicker from './TimePicker';
import ConfirmDialog from './ConfirmDialog';
import type { ItineraryItemDto } from '@/types';

interface Props {
  tripId: string;
  stopId: string;
  initialItems: ItineraryItemDto[];
}

/**
 * The per-stop plan: add, reorder, retime and edit activities.
 *
 * Ordering is by `position` and drag, never by time. Sorting by time would
 * fight the user the moment an untimed item exists, and would make dragging
 * meaningless — so a time is information attached to a row, not the thing that
 * places it.
 */
export default function ItineraryPanel({ tripId, stopId, initialItems }: Props) {
  const [items, setItems] = useState<ItineraryItemDto[]>(initialItems);
  const [title, setTitle] = useState('');
  /** Minutes from midnight, or null. No longer a string: it cannot be invalid. */
  const [time, setTime] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ItineraryItemDto | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function addItem() {
    const trimmed = title.trim();
    if (trimmed === '' || busy) return;

    setBusy(true);
    setError(null);
    try {
      // `time` is already either a valid minute-of-day or null — the picker
      // cannot produce anything else, so there is nothing to validate here.
      const { item } = await api.addItineraryItem(tripId, stopId, {
        title: trimmed,
        startMinutes: time,
      });
      setItems((current) => [...current, item]);
      setTitle('');
      setTime(null);
    } catch {
      setError('Could not add that item.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(item: ItineraryItemDto, patchBody: Partial<ItineraryItemDto>) {
    // Optimistic: the field is already showing the new value as you type.
    setItems((current) =>
      current.map((row) => (row.id === item.id ? { ...row, ...patchBody } : row)),
    );
    try {
      await api.patchItineraryItem(tripId, stopId, item.id, {
        title: patchBody.title,
        notes: patchBody.notes,
        startMinutes: patchBody.startMinutes,
      });
    } catch {
      setError('Could not save that change.');
    }
  }

  async function confirmDelete() {
    const target = pendingDelete;
    if (!target) return;
    setPendingDelete(null);
    const previous = items;
    setItems((current) => current.filter((row) => row.id !== target.id));
    try {
      await api.deleteItineraryItem(tripId, stopId, target.id);
    } catch {
      setItems(previous);
      setError('Could not remove that item.');
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const from = items.findIndex((row) => row.id === active.id);
    const to = items.findIndex((row) => row.id === over.id);
    if (from === -1 || to === -1) return;

    const previous = items;
    const next = arrayMove(items, from, to);
    setItems(next);
    try {
      await api.reorderItinerary(
        tripId,
        stopId,
        next.map((row) => row.id),
      );
    } catch {
      setItems(previous);
      setError('Could not save the new order.');
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-semibold">Itinerary</h2>
        <span className="text-[11px] text-ink-faint">
          {items.length === 0
            ? 'Nothing planned'
            : `${items.length} ${items.length === 1 ? 'item' : 'items'}`}
        </span>
      </div>

      <div className="p-4">
        {/* Add form. Enter in either field submits, which is the fast path. */}
        <div className="flex flex-wrap items-start gap-2">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void addItem();
              }
            }}
            placeholder="Add an activity…"
            aria-label="Activity"
            className={`${input} min-w-0 flex-1`}
          />
          <TimePicker
            value={time}
            onChange={setTime}
            label="the new activity"
            className="shrink-0"
          />
          <button
            type="button"
            onClick={addItem}
            disabled={busy || title.trim() === ''}
            className={button.primary}
          >
            Add
          </button>
        </div>

        {error ? (
          <p className="mt-2 text-[13px] text-danger" role="status">
            {error}
          </p>
        ) : null}

        {items.length === 0 ? (
          <EmptyState
            title="No plans yet"
            body="Add the things you want to do at this stop. Give them times if you like — they’ll stay in the order you set either way."
          />
        ) : (
          <DndContext
            id={`itinerary-${stopId}`}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext
              items={items.map((row) => row.id)}
              strategy={verticalListSortingStrategy}
            >
              <ul className="mt-4 space-y-2">
                {items.map((item) => (
                  <ItineraryRow
                    key={item.id}
                    item={item}
                    onPatch={patch}
                    onRemove={() => setPendingDelete(item)}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {pendingDelete ? (
        <ConfirmDialog
          title={`Remove “${pendingDelete.title}”?`}
          message="This can't be undone."
          confirmLabel="Remove"
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      ) : null}
    </section>
  );
}

function ItineraryRow({
  item,
  onPatch,
  onRemove,
}: {
  item: ItineraryItemDto;
  onPatch: (item: ItineraryItemDto, patch: Partial<ItineraryItemDto>) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group flex items-start gap-2.5 rounded-control border p-2.5 ${
        isDragging ? 'z-10 border-accent/40 bg-surface shadow-pop' : 'border-line bg-surface'
      }`}
    >
      <button
        type="button"
        className="mt-1 shrink-0 cursor-grab touch-none rounded p-1 text-ink-faint hover:bg-inset hover:text-ink active:cursor-grabbing"
        aria-label={`Reorder ${item.title}. Press space, then use arrow keys.`}
        {...attributes}
        {...listeners}
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
          <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />
        </svg>
      </button>

      <TimePicker
        value={item.startMinutes}
        onChange={(startMinutes) => onPatch(item, { startMinutes })}
        label={item.title}
        className="mt-0.5 shrink-0"
      />

      <div className="min-w-0 flex-1">
        <input
          value={item.title}
          onChange={(event) => onPatch(item, { title: event.target.value })}
          aria-label="Activity"
          className="w-full truncate rounded border-0 bg-transparent px-1 py-1 text-sm text-ink outline-none transition-colors hover:bg-inset focus:bg-inset"
        />
        <textarea
          value={item.notes ?? ''}
          onChange={(event) => onPatch(item, { notes: event.target.value })}
          placeholder="Notes…"
          rows={1}
          aria-label={`Notes for ${item.title}`}
          className="mt-1 w-full resize-y rounded border-0 bg-transparent px-1 py-0.5 text-[13px] text-ink-muted outline-none transition-colors placeholder:text-ink-faint hover:bg-inset focus:bg-inset"
        />
      </div>

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${item.title}`}
        title={`Remove ${item.title}`}
        className="mt-0.5 shrink-0 rounded-control p-1.5 text-ink-faint opacity-0 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </li>
  );
}
