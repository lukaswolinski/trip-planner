/**
 * Wires the routing core to its real dependencies: the Postgres leg cache and
 * whichever provider is configured.
 *
 * Everything in lib/routing is dependency-injected so it can be tested without
 * credentials or network; this is the one module that supplies the production
 * wiring.
 */
import 'server-only';

import type { Database } from '@/lib/db';
import type { StopRow, TripRow } from '@/lib/trips/repository';
import { CACHE_TTL_DAYS, type TravelProfile } from '@/lib/limits';
import { createDbLegCache } from './cache';
import { cacheTtlDays, createRouter } from './provider';
import { buildTripSummary, type SummaryStop, type TripSummary } from './summary';

export function toSummaryStops(stops: readonly StopRow[]): SummaryStop[] {
  return stops.map((stop) => ({
    id: stop.id,
    lat: stop.lat,
    lng: stop.lng,
    days: stop.days,
    profileToNext: (stop.profileToNext as TravelProfile | null) ?? null,
  }));
}

export async function summarizeTrip(
  db: Database,
  trip: Pick<TripRow, 'defaultProfile'>,
  stops: readonly StopRow[],
  now: Date = new Date(),
): Promise<TripSummary> {
  return buildTripSummary(
    toSummaryStops(stops),
    (trip.defaultProfile as TravelProfile) ?? 'driving',
    {
      cache: createDbLegCache(db, cacheTtlDays(CACHE_TTL_DAYS)),
      router: createRouter(),
      now,
    },
  );
}

/** Days since the oldest leg estimate, for the "updated N days ago" label. */
export function estimateAgeDays(
  estimatesFetchedAt: Date | null,
  now: Date = new Date(),
): number | null {
  if (!estimatesFetchedAt) return null;
  const ms = now.getTime() - estimatesFetchedAt.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}
