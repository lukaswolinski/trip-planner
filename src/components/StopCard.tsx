'use client';

import Link from 'next/link';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { formatCoordinates } from '@/lib/coords';
import { inputCompact } from './ui';
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

  /*
   * A stop added by pasting coordinates carries the coordinates as its name AND
   * as its address, and the card then printed them a third time underneath.
   * Three identical strings was most of the visual noise in the list. Each line
   * now appears only when it says something the line above did not.
   */
  const coords = formatCoordinates(stop.lat, stop.lng);
  const showAddress = !!stop.address && stop.address !== stop.name;
  const showCoords = stop.name !== coords && stop.address !== coords;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`group rounded-card border bg-surface transition-shadow ${
        isDragging
          ? 'z-10 border-accent/40 shadow-pop'
          : 'border-line hover:border-line-strong'
      }`}
    >
      <div className="flex items-start gap-3 p-3.5 pb-2.5">
        {/*
          The drag handle carries dnd-kit's listeners and attributes, which
          include the ARIA roles and keyboard bindings. Keyboard dragging
          (Space, arrows, Space) works because of these — don't strip them.

          Styling only: the badge now matches the map pin exactly, so the
          correspondence between the list and the map is immediate.
        */}
        <button
          type="button"
          className="mt-px flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink shadow-card ring-2 ring-surface transition-transform active:scale-95 active:cursor-grabbing"
          aria-label={`Reorder ${stop.name}. Press space, then use arrow keys.`}
          {...attributes}
          {...listeners}
        >
          {index + 1}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <input
              value={stop.name}
              onChange={(event) => onPatch(stop.id, { name: event.target.value })}
              className="min-w-0 flex-1 truncate rounded border-0 bg-transparent px-1 py-0.5 text-[15px] font-medium text-ink outline-none transition-colors hover:bg-inset focus:bg-inset"
              aria-label="Stop name"
            />
            <Link
              href={`/trips/${stop.tripId}/stops/${stop.id}`}
              title={`Open ${stop.name}`}
              aria-label={`Open destination page for ${stop.name}`}
              className="shrink-0 rounded-control p-1 text-ink-faint opacity-0 transition-opacity hover:bg-inset hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
            >
              <svg
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d="M9 18l6-6-6-6" />
              </svg>
            </Link>
          </div>

          {showAddress ? (
            <p className="truncate px-1 text-[13px] text-ink-muted">{stop.address}</p>
          ) : null}
          {showCoords ? (
            <p
              className="tnum px-1 text-[11px] text-ink-faint"
              title="Drag the numbered marker on the map to move this stop"
            >
              {coords}
            </p>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => onRemove(stop.id)}
          className="shrink-0 rounded-control p-1.5 text-ink-faint opacity-0 transition hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={`Remove ${stop.name}`}
          title={`Remove ${stop.name}`}
        >
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Left padding aligns these with the stop name, not the badge. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3.5 pb-3 pl-[3.375rem]">
        <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
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
            className={`${inputCompact} tnum w-14`}
          />
        </label>

        {hasNext ? (
          <label className="flex items-center gap-1.5 text-[13px] text-ink-muted">
            Then
            <select
              value={stop.profileToNext ?? tripDefaultProfile}
              onChange={(event) =>
                onProfileChange(stop.id, event.target.value as TravelProfile)
              }
              className={inputCompact}
            >
              <option value="driving">Drive</option>
              <option value="walking">Walk</option>
            </select>
          </label>
        ) : null}
      </div>

      <div className="px-3.5 pb-3.5 pl-[3.375rem]">
        <textarea
          value={stop.notes ?? ''}
          onChange={(event) => onPatch(stop.id, { notes: event.target.value })}
          placeholder="Notes — campsite booking, what to see, who to call…"
          rows={2}
          className="w-full resize-y rounded-control border border-transparent bg-inset px-2.5 py-2 text-[13px] leading-relaxed text-ink outline-none transition-colors placeholder:text-ink-faint hover:border-line focus:border-accent focus:bg-surface focus:ring-2 focus:ring-accent/20"
        />
      </div>
    </li>
  );
}
