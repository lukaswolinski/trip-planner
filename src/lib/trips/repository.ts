/**
 * All trip and stop persistence.
 *
 * Two invariants are enforced here rather than in route handlers, so there is
 * exactly one place to audit:
 *
 * 1. **Ownership.** Every read and write is scoped by `ownedBy()`. There is no
 *    code path that mutates a trip by share slug.
 * 2. **Contiguous positions.** Insert, delete and reorder all leave
 *    `stops.position` as 0..n-1 with no gaps, inside a transaction.
 */

import { and, asc, desc, eq, gt, gte, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { stops, trips } from '@/lib/db/schema';
import type { SessionContext } from '@/lib/auth/session';
import type { TravelProfile } from '@/lib/limits';
import { randomBytes } from 'node:crypto';

export type TripRow = typeof trips.$inferSelect;
export type StopRow = typeof stops.$inferSelect;

/**
 * A trip is reachable by the session that created it, or by the user who
 * claimed it. Both are checked because a claimed trip's `session_id` may later
 * be nulled by the cleanup sweep.
 */
function ownedBy(context: SessionContext): SQL {
  const bySession = eq(trips.sessionId, context.sessionId);
  if (!context.userId) return bySession;
  return or(bySession, eq(trips.userId, context.userId))!;
}

export async function createTrip(
  db: Database,
  context: SessionContext,
  input: { title?: string; defaultProfile?: TravelProfile },
): Promise<TripRow> {
  const [trip] = await db
    .insert(trips)
    .values({
      sessionId: context.sessionId,
      userId: context.userId,
      title: input.title ?? 'Untitled trip',
      defaultProfile: input.defaultProfile ?? 'driving',
    })
    .returning();
  return trip;
}

/**
 * `stopCount` comes from a LEFT JOIN + GROUP BY, not a correlated subquery.
 *
 * The subquery version was silently always 0. Inside a `sql` template used in a
 * selection, Drizzle renders columns *unqualified*, so
 * `sql\`… from ${stops} where ${stops.tripId} = ${trips.id}\`` became
 * `from "stops" where "trip_id" = "id"` — and since `stops` has both columns,
 * that compared `stops.trip_id` to `stops.id` and never matched. A join gives
 * Drizzle the context to qualify properly (verified: `count("stops"."id")`).
 */
export async function listTrips(db: Database, context: SessionContext) {
  return db
    .select({
      id: trips.id,
      title: trips.title,
      defaultProfile: trips.defaultProfile,
      shareSlug: trips.shareSlug,
      version: trips.version,
      updatedAt: trips.updatedAt,
      pinnedAt: trips.pinnedAt,
      // count() of the joined id ignores the NULL row a stopless trip produces.
      stopCount: sql<number>`count(${stops.id})::int`,
    })
    .from(trips)
    .leftJoin(stops, eq(stops.tripId, trips.id))
    .where(ownedBy(context))
    .groupBy(trips.id)
    // Pinned first. `nulls last` is required: in Postgres, DESC puts NULLs
    // first by default, which would sort every unpinned trip above the pinned
    // ones — the exact opposite of the feature.
    .orderBy(sql`${trips.pinnedAt} desc nulls last`, desc(trips.updatedAt));
}

export async function getOwnedTrip(
  db: Database,
  tripId: string,
  context: SessionContext,
): Promise<TripRow | null> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, tripId), ownedBy(context)))
    .limit(1);
  return trip ?? null;
}

/** Read-only lookup for the public share page. Never used for writes. */
export async function getTripByShareSlug(
  db: Database,
  slug: string,
): Promise<TripRow | null> {
  const [trip] = await db
    .select()
    .from(trips)
    .where(eq(trips.shareSlug, slug))
    .limit(1);
  return trip ?? null;
}

export async function listStops(db: Database, tripId: string): Promise<StopRow[]> {
  return db
    .select()
    .from(stops)
    .where(eq(stops.tripId, tripId))
    .orderBy(asc(stops.position));
}

export async function countStops(db: Database, tripId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(stops)
    .where(eq(stops.tripId, tripId));
  return row?.count ?? 0;
}

export type PatchTripResult =
  | { status: 'ok'; trip: TripRow }
  | { status: 'not_found' }
  | { status: 'conflict'; currentVersion: number };

export async function patchTrip(
  db: Database,
  tripId: string,
  context: SessionContext,
  input: {
    title?: string;
    defaultProfile?: TravelProfile;
    pinned?: boolean;
    version: number;
  },
): Promise<PatchTripResult> {
  const existing = await getOwnedTrip(db, tripId, context);
  if (!existing) return { status: 'not_found' };
  if (existing.version !== input.version) {
    return { status: 'conflict', currentVersion: existing.version };
  }

  const [trip] = await db
    .update(trips)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.defaultProfile !== undefined
        ? { defaultProfile: input.defaultProfile }
        : {}),
      ...(input.pinned !== undefined
        ? { pinnedAt: input.pinned ? sql`now()` : null }
        : {}),
      version: sql`${trips.version} + 1`,
      /*
       * Only a content change touches `updatedAt`.
       *
       * Pinning is a presentation choice, not an edit. Bumping the timestamp
       * for it meant unpinning left the trip sitting at the top of the
       * recency-ordered list instead of returning to where it belonged — the
       * pin looked like it had not been removed. `version` still increments,
       * because that guards concurrent writes regardless of what changed.
       */
      ...(input.title !== undefined || input.defaultProfile !== undefined
        ? { updatedAt: sql`now()` }
        : {}),
    })
    .where(and(eq(trips.id, tripId), eq(trips.version, input.version)))
    .returning();

  // Lost a race with a concurrent writer between the check and the update.
  if (!trip) return { status: 'conflict', currentVersion: existing.version };
  return { status: 'ok', trip };
}

export async function deleteTrip(
  db: Database,
  tripId: string,
  context: SessionContext,
): Promise<boolean> {
  const deleted = await db
    .delete(trips)
    .where(and(eq(trips.id, tripId), ownedBy(context)))
    .returning({ id: trips.id });
  return deleted.length > 0;
}

/** Bumps version and updatedAt after a change to a trip's stops. */
async function touchTrip(db: Database, tripId: string): Promise<void> {
  await db
    .update(trips)
    .set({ version: sql`${trips.version} + 1`, updatedAt: sql`now()` })
    .where(eq(trips.id, tripId));
}

export interface AddStopInput {
  name: string;
  address?: string | null;
  lat: number;
  lng: number;
  notes?: string | null;
  days?: number;
  profileToNext?: TravelProfile | null;
  position?: number;
}

export type AddStopResult =
  | { status: 'ok'; stop: StopRow }
  | { status: 'too_many'; limit: number };

export async function addStop(
  db: Database,
  tripId: string,
  input: AddStopInput,
  hardMaxStops: number,
): Promise<AddStopResult> {
  return db.transaction(async (tx) => {
    const [countRow] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(stops)
      .where(eq(stops.tripId, tripId));
    const current = countRow?.count ?? 0;

    if (current >= hardMaxStops) {
      return { status: 'too_many', limit: hardMaxStops };
    }

    const position = Math.min(input.position ?? current, current);

    // Make room, keeping positions contiguous.
    if (position < current) {
      await tx
        .update(stops)
        .set({ position: sql`${stops.position} + 1` })
        .where(and(eq(stops.tripId, tripId), gte(stops.position, position)));
    }

    const [stop] = await tx
      .insert(stops)
      .values({
        tripId,
        position,
        name: input.name,
        address: input.address ?? null,
        lat: input.lat,
        lng: input.lng,
        notes: input.notes ?? null,
        days: input.days ?? 0,
        profileToNext: input.profileToNext ?? null,
      })
      .returning();

    await tx
      .update(trips)
      .set({ version: sql`${trips.version} + 1`, updatedAt: sql`now()` })
      .where(eq(trips.id, tripId));

    return { status: 'ok', stop };
  });
}

export async function patchStop(
  db: Database,
  tripId: string,
  stopId: string,
  input: {
    name?: string;
    address?: string | null;
    notes?: string | null;
    days?: number;
    profileToNext?: TravelProfile | null;
    lat?: number;
    lng?: number;
  },
): Promise<StopRow | null> {
  const [stop] = await db
    .update(stops)
    .set({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.days !== undefined ? { days: input.days } : {}),
      ...(input.profileToNext !== undefined
        ? { profileToNext: input.profileToNext }
        : {}),
      // Moving a stop changes which legs exist, so the caller must recompute the
      // route afterwards.
      ...(input.lat !== undefined ? { lat: input.lat } : {}),
      ...(input.lng !== undefined ? { lng: input.lng } : {}),
    })
    .where(and(eq(stops.id, stopId), eq(stops.tripId, tripId)))
    .returning();

  if (!stop) return null;
  await touchTrip(db, tripId);
  return stop;
}

export async function deleteStop(
  db: Database,
  tripId: string,
  stopId: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [removed] = await tx
      .delete(stops)
      .where(and(eq(stops.id, stopId), eq(stops.tripId, tripId)))
      .returning({ position: stops.position });

    if (!removed) return false;

    // Close the gap so positions stay 0..n-1.
    await tx
      .update(stops)
      .set({ position: sql`${stops.position} - 1` })
      .where(and(eq(stops.tripId, tripId), gt(stops.position, removed.position)));

    await tx
      .update(trips)
      .set({ version: sql`${trips.version} + 1`, updatedAt: sql`now()` })
      .where(eq(trips.id, tripId));

    return true;
  });
}

export type ReorderResult = { status: 'ok' } | { status: 'mismatch'; message: string };

/**
 * Applies a complete new ordering.
 *
 * The permutation check is the security-relevant part: without it a caller
 * could splice a stop id belonging to someone else's trip into the array. Any
 * id that is not already in this trip, or any missing id, rejects the whole
 * request rather than partially applying it.
 */
export async function reorderStops(
  db: Database,
  tripId: string,
  stopIds: readonly string[],
): Promise<ReorderResult> {
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: stops.id })
      .from(stops)
      .where(eq(stops.tripId, tripId));

    const existingIds = new Set(existing.map((s) => s.id));
    const providedIds = new Set(stopIds);

    if (providedIds.size !== stopIds.length) {
      return { status: 'mismatch', message: 'Duplicate stop ids in ordering' };
    }
    if (providedIds.size !== existingIds.size) {
      return {
        status: 'mismatch',
        message: `Ordering has ${providedIds.size} stops but the trip has ${existingIds.size}`,
      };
    }
    for (const id of providedIds) {
      if (!existingIds.has(id)) {
        return { status: 'mismatch', message: 'Ordering contains an unknown stop id' };
      }
    }

    // One statement renumbers every row. `stops.position` has a non-unique
    // index precisely so this needs no deferrable constraint dance.
    const values = sql.join(
      stopIds.map((id, index) => sql`(${id}::uuid, ${index}::int)`),
      sql`, `,
    );
    await tx.execute(sql`
      update ${stops} as s
      set position = v.pos
      from (values ${values}) as v(id, pos)
      where s.id = v.id and s.trip_id = ${tripId}::uuid
    `);

    await tx
      .update(trips)
      .set({ version: sql`${trips.version} + 1`, updatedAt: sql`now()` })
      .where(eq(trips.id, tripId));

    return { status: 'ok' };
  });
}

/**
 * 16 random bytes as 22 base64url characters: 2^128 of keyspace, so a share
 * link cannot be found by guessing, and nothing about the trip or its owner is
 * encoded in it.
 */
export function newShareSlug(): string {
  return randomBytes(16).toString('base64url');
}

export async function setShareSlug(
  db: Database,
  tripId: string,
  context: SessionContext,
  slug: string | null,
): Promise<TripRow | null> {
  const [trip] = await db
    .update(trips)
    .set({
      shareSlug: slug,
      sharedAt: slug ? sql`now()` : null,
      updatedAt: sql`now()`,
    })
    .where(and(eq(trips.id, tripId), ownedBy(context)))
    .returning();
  return trip ?? null;
}

/** Attaches every unclaimed trip from this session to a user. */
export async function claimTripsForUser(
  db: Database,
  sessionId: string,
  userId: string,
): Promise<number> {
  const claimed = await db
    .update(trips)
    .set({ userId })
    .where(and(eq(trips.sessionId, sessionId), isNull(trips.userId)))
    .returning({ id: trips.id });
  return claimed.length;
}

export { lt };
