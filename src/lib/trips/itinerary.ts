/**
 * Itinerary persistence for one stop.
 *
 * Same two invariants as the stop repository, for the same reason — one place
 * to audit:
 *
 * 1. **Ownership.** Nothing here takes an item id alone. Every call is scoped
 *    by `stopId`, and the route handler resolves that stop through a trip the
 *    caller owns first. A guessed item id therefore leads nowhere.
 * 2. **Contiguous positions.** Insert, delete and reorder all leave
 *    `position` as 0..n-1 with no gaps, inside a transaction.
 */

import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { itineraryItems, stops } from '@/lib/db/schema';

export type ItineraryItemRow = typeof itineraryItems.$inferSelect;

export interface ItineraryInput {
  title: string;
  notes?: string | null;
  /** Minutes from midnight, or null for an untimed item. */
  startMinutes?: number | null;
}

/** Confirms a stop belongs to a trip. The trip's ownership is checked upstream. */
export async function stopBelongsToTrip(
  db: Database,
  tripId: string,
  stopId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: stops.id })
    .from(stops)
    .where(and(eq(stops.id, stopId), eq(stops.tripId, tripId)))
    .limit(1);
  return !!row;
}

export async function listItinerary(
  db: Database,
  stopId: string,
): Promise<ItineraryItemRow[]> {
  return db
    .select()
    .from(itineraryItems)
    .where(eq(itineraryItems.stopId, stopId))
    .orderBy(asc(itineraryItems.position));
}

export async function addItineraryItem(
  db: Database,
  stopId: string,
  input: ItineraryInput,
): Promise<ItineraryItemRow> {
  return db.transaction(async (tx) => {
    // Append. count() inside the transaction so two concurrent adds cannot
    // both claim the same position.
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(itineraryItems)
      .where(eq(itineraryItems.stopId, stopId));

    const [item] = await tx
      .insert(itineraryItems)
      .values({
        stopId,
        position: count,
        title: input.title,
        notes: input.notes ?? null,
        startMinutes: input.startMinutes ?? null,
      })
      .returning();
    return item;
  });
}

export async function patchItineraryItem(
  db: Database,
  stopId: string,
  itemId: string,
  input: Partial<ItineraryInput>,
): Promise<ItineraryItemRow | null> {
  const [item] = await db
    .update(itineraryItems)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.startMinutes !== undefined
        ? { startMinutes: input.startMinutes }
        : {}),
      updatedAt: sql`now()`,
    })
    // Scoped by stopId as well as id: an item id from another stop must not
    // match, even though the id alone would be unique.
    .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.stopId, stopId)))
    .returning();
  return item ?? null;
}

export async function deleteItineraryItem(
  db: Database,
  stopId: string,
  itemId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(itineraryItems)
      .where(and(eq(itineraryItems.id, itemId), eq(itineraryItems.stopId, stopId)))
      .returning({ position: itineraryItems.position });

    if (!removed) return false;

    // Close the gap, so positions stay 0..n-1.
    await tx
      .update(itineraryItems)
      .set({ position: sql`${itineraryItems.position} - 1` })
      .where(
        and(
          eq(itineraryItems.stopId, stopId),
          gt(itineraryItems.position, removed.position),
        ),
      );
    return true;
  });
}

/**
 * Applies a full ordering.
 *
 * `orderedIds` must be a permutation of this stop's items — anything else is
 * rejected rather than partially applied, which is what stops an injected id
 * from another stop being written in.
 */
export async function reorderItinerary(
  db: Database,
  stopId: string,
  orderedIds: readonly string[],
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: itineraryItems.id })
      .from(itineraryItems)
      .where(eq(itineraryItems.stopId, stopId));

    if (existing.length !== orderedIds.length) return false;
    const known = new Set(existing.map((row) => row.id));
    if (orderedIds.some((id) => !known.has(id))) return false;
    if (new Set(orderedIds).size !== orderedIds.length) return false;

    /*
     * Two passes via a large offset.
     *
     * Positions are not unique-indexed, but writing 0..n-1 directly would still
     * transiently collide if a future index is added. Offsetting first keeps
     * this correct under either schema and costs one extra statement.
     */
    await tx
      .update(itineraryItems)
      .set({ position: sql`${itineraryItems.position} + 100000` })
      .where(eq(itineraryItems.stopId, stopId));

    for (const [index, id] of orderedIds.entries()) {
      await tx
        .update(itineraryItems)
        .set({ position: index })
        .where(and(eq(itineraryItems.id, id), eq(itineraryItems.stopId, stopId)));
    }
    return true;
  });
}
