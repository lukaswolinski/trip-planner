'use client';

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatCoordinates } from '@/lib/coords';
import type { StopDto } from '@/types';
import type { TravelProfile } from '@/lib/limits';

interface Props {
  stop: StopDto;
  index: number;
  onPatch: (
    stopId: string,
    patch: { name?: string; notes?: string | null; days?: number },
  ) => void;
  onRemove: (stopId: string) => void;
  onProfileChange: (stopId: string, profile: TravelProfile) => void;
  /** Whether this stop has a next stop, so a travel mode applies. */
  hasNext: boolean;
  tripDefaultProfile: TravelProfile;
}

/**
 * Fully controlled by the parent — no local mirrors of the props.
 *
 * TripEditor applies every edit optimistically before its debounced PATCH, so
 * `stop` already reflects the latest keystroke. Copying props into state here
 * would add an effect that syncs them back, which is both redundant and a
 * cascading-render hazard.
 */
export default function StopCard({
  stop,
  index,
  onPatch,
  onRemove,
  onProfileChange,
  hasNext,
  tripDefaultProfile,
}: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: stop.id });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border border-black/10 bg-white p-3 shadow-sm dark:border-white/15 dark:bg-white/[0.04] ${
        isDragging ? 'z-10 opacity-90 shadow-lg' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        {/*
          The drag handle carries dnd-kit's listeners and attributes, which
          include the ARIA roles and keyboard bindings. Keyboard dragging
          (Space, arrows, Space) works because of these — don't strip them.
        */}
        <button
          type="button"
          className="mt-0.5 flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white active:cursor-grabbing"
          aria-label={`Reorder ${stop.name}. Press space, then use arrow keys.`}
          {...attributes}
          {...listeners}
        >
          {index + 1}
        </button>

        <div className="min-w-0 flex-1">
          <input
            value={stop.name}
            onChange={(event) => onPatch(stop.id, { name: event.target.value })}
            className="w-full truncate border-0 bg-transparent p-0 text-sm font-medium outline-none focus:ring-0"
            aria-label="Stop name"
          />
          {stop.address ? (
            <p className="truncate text-xs text-black/50 dark:text-white/50">
              {stop.address}
            </p>
          ) : null}
          {/*
            Coordinates are shown because markers can be dragged: this is how you
            see what a drag actually changed, and they are the source of truth for
            where the stop is.
          */}
          <p
            className="mt-0.5 font-mono text-[11px] text-black/40 dark:text-white/40"
            title="Drag the numbered marker on the map to move this stop"
          >
            {formatCoordinates(stop.lat, stop.lng)}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onRemove(stop.id)}
          className="shrink-0 rounded px-2 py-1 text-xs text-black/50 hover:bg-red-50 hover:text-red-600 dark:text-white/50 dark:hover:bg-red-950/40"
          aria-label={`Remove ${stop.name}`}
        >
          Remove
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-black/60 dark:text-white/60">
          Nights
          <input
            type="number"
            min={0}
            max={365}
            value={stop.days}
            onChange={(event) => {
              const days = Number(event.target.value);
              if (Number.isInteger(days) && days >= 0) onPatch(stop.id, { days });
            }}
            /*
             * Browsers step a focused number input on wheel, so scrolling the
             * page over this field silently changed the night count. Blurring on
             * wheel stops that; preventDefault would not, because React attaches
             * wheel listeners passively.
             */
            onWheel={(event) => event.currentTarget.blur()}
            className="w-16 rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs dark:border-white/20"
          />
        </label>

        {hasNext ? (
          <label className="flex items-center gap-1.5 text-xs text-black/60 dark:text-white/60">
            Travel to next
            <select
              value={stop.profileToNext ?? tripDefaultProfile}
              onChange={(event) =>
                onProfileChange(stop.id, event.target.value as TravelProfile)
              }
              className="rounded border border-black/15 bg-transparent px-1.5 py-0.5 text-xs dark:border-white/20"
            >
              <option value="driving">Drive</option>
              <option value="walking">Walk</option>
            </select>
          </label>
        ) : null}
      </div>

      <textarea
        value={stop.notes ?? ''}
        onChange={(event) => onPatch(stop.id, { notes: event.target.value })}
        placeholder="Notes — campsite booking, what to see, who to call…"
        rows={2}
        className="mt-2 w-full resize-y rounded border border-black/10 bg-transparent px-2 py-1.5 text-xs outline-none placeholder:text-black/35 focus:border-blue-500 dark:border-white/15 dark:placeholder:text-white/35"
      />
    </li>
  );
}
