'use client';

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
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import StopCard from './StopCard';
import LegRow from './LegRow';
import type { StopDto, SummaryLegDto } from '@/types';
import type { TravelProfile } from '@/lib/limits';

interface Props {
  stops: readonly StopDto[];
  legs: readonly SummaryLegDto[];
  tripDefaultProfile: TravelProfile;
  unit: 'km' | 'mi';
  stale: boolean;
  onReorder: (orderedIds: string[]) => void;
  onPatch: (
    stopId: string,
    patch: { name?: string; notes?: string | null; days?: number },
  ) => void;
  onRemove: (stopId: string) => void;
  onProfileChange: (stopId: string, profile: TravelProfile) => void;
}

export default function StopList({
  stops,
  legs,
  tripDefaultProfile,
  unit,
  stale,
  onReorder,
  onPatch,
  onRemove,
  onProfileChange,
}: Props) {
  const sensors = useSensors(
    // A small activation distance keeps a click on the number badge from
    // starting a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = stops.map((s) => s.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;

    const next = [...ids];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  }

  const legByFrom = new Map(legs.map((leg) => [leg.fromStopId, leg]));

  return (
    /*
     * A stable `id` is required, not optional. Without it dnd-kit generates
     * incrementing ids per instance, which differ between the server render and
     * the client render and produce a hydration mismatch on
     * `aria-describedby` for every stop.
     */
    <DndContext
      id="stop-list"
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={stops.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <ol className="space-y-0">
          {stops.map((stop, index) => (
            <div key={stop.id}>
              <StopCard
                stop={stop}
                index={index}
                onPatch={onPatch}
                onRemove={onRemove}
                onProfileChange={onProfileChange}
                hasNext={index < stops.length - 1}
                tripDefaultProfile={tripDefaultProfile}
              />
              {/*
                Per-leg distance and time sit *between* the cards, which is where
                people look for "how far is the next drive".
              */}
              {index < stops.length - 1 ? (
                <LegRow leg={legByFrom.get(stop.id)} unit={unit} stale={stale} />
              ) : null}
            </div>
          ))}
        </ol>
      </SortableContext>
    </DndContext>
  );
}
