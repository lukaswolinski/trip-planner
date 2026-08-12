/**
 * The per-leg routing cache.
 *
 * Reads are filtered on `fetched_at`, so a row older than CACHE_TTL_DAYS reads
 * as a miss and gets refetched. That single filter serves two purposes at once:
 * it honours Mapbox's 30-day cap on retaining routing results, and it keeps
 * drive-time estimates from silently going stale.
 */

import { and, gt, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { routeLegs } from '@/lib/db/schema';
import { CACHE_TTL_DAYS, type TravelProfile } from '@/lib/limits';
import type { LegResult } from './chunked-router';
import { legKeyId, type LegKey } from './legs';

export interface CachedLeg {
  distanceM: number;
  durationS: number;
  geometry: string;
  fetchedAt: Date;
  /** See LegResult.isFlight — an unroutable pair, cached so it is found once. */
  isFlight?: boolean;
}

export interface LegCache {
  /** Returns only entries fresher than the TTL, keyed by `legKeyId`. */
  getFresh(keys: readonly LegKey[], now: Date): Promise<Map<string, CachedLeg>>;
  put(legs: readonly LegResult[], now: Date): Promise<void>;
}

export function cutoffFor(now: Date, ttlDays = CACHE_TTL_DAYS): Date {
  return new Date(now.getTime() - ttlDays * 24 * 60 * 60 * 1000);
}

/** Deduplicates keys so a trip that repeats a leg queries for it once. */
function uniqueKeys(keys: readonly LegKey[]): LegKey[] {
  const seen = new Map<string, LegKey>();
  for (const key of keys) {
    const id = legKeyId(key);
    if (!seen.has(id)) seen.set(id, key);
  }
  return [...seen.values()];
}

/**
 * `ttlDays` is passed in rather than read from the environment here, so this
 * module stays free of `server-only` imports and remains usable from tests. The
 * effective value comes from `cacheTtlDays()` in provider.ts, which clamps to
 * Mapbox's 30-day ceiling when that provider is selected.
 */
export function createDbLegCache(
  db: Database,
  ttlDays: number = CACHE_TTL_DAYS,
): LegCache {
  return {
    async getFresh(keys, now) {
      const found = new Map<string, CachedLeg>();
      const unique = uniqueKeys(keys);
      if (unique.length === 0) return found;

      // Row-value IN, so one round trip resolves the whole trip's legs.
      const tuples = unique.map(
        (k) =>
          sql`(${k.profile}, ${k.from.lat}::numeric, ${k.from.lng}::numeric, ${k.to.lat}::numeric, ${k.to.lng}::numeric)`,
      );

      const rows = await db
        .select({
          profile: routeLegs.profile,
          fromLat: routeLegs.fromLat,
          fromLng: routeLegs.fromLng,
          toLat: routeLegs.toLat,
          toLng: routeLegs.toLng,
          distanceM: routeLegs.distanceM,
          durationS: routeLegs.durationS,
          geometry: routeLegs.geometry,
          isFlight: routeLegs.isFlight,
          fetchedAt: routeLegs.fetchedAt,
        })
        .from(routeLegs)
        .where(
          and(
            gt(routeLegs.fetchedAt, cutoffFor(now, ttlDays)),
            sql`(${routeLegs.profile}, ${routeLegs.fromLat}, ${routeLegs.fromLng}, ${routeLegs.toLat}, ${routeLegs.toLng}) in (${sql.join(tuples, sql`, `)})`,
          ),
        );

      for (const row of rows) {
        const id = legKeyId({
          profile: row.profile as TravelProfile,
          from: { lat: row.fromLat, lng: row.fromLng },
          to: { lat: row.toLat, lng: row.toLng },
        });
        found.set(id, {
          distanceM: row.distanceM,
          durationS: row.durationS,
          geometry: row.geometry,
          isFlight: row.isFlight,
          fetchedAt: row.fetchedAt,
        });
      }

      return found;
    },

    async put(legs, now) {
      if (legs.length === 0) return;

      // Deduplicate before insert: a single request can legitimately contain the
      // same leg twice, and Postgres rejects two conflicting rows in one
      // INSERT ... ON CONFLICT statement.
      const byId = new Map<string, LegResult>();
      for (const leg of legs) byId.set(legKeyId(leg.key), leg);

      await db
        .insert(routeLegs)
        .values(
          [...byId.values()].map((leg) => ({
            profile: leg.key.profile,
            fromLat: leg.key.from.lat,
            fromLng: leg.key.from.lng,
            toLat: leg.key.to.lat,
            toLng: leg.key.to.lng,
            distanceM: leg.distanceM,
            durationS: leg.durationS,
            geometry: leg.geometry,
            isFlight: leg.isFlight ?? false,
            fetchedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: [
            routeLegs.profile,
            routeLegs.fromLat,
            routeLegs.fromLng,
            routeLegs.toLat,
            routeLegs.toLng,
          ],
          set: {
            distanceM: sql`excluded.distance_m`,
            durationS: sql`excluded.duration_s`,
            geometry: sql`excluded.geometry`,
            isFlight: sql`excluded.is_flight`,
            fetchedAt: sql`excluded.fetched_at`,
          },
        });
    },
  };
}

/** In-memory cache used by tests and as a request-scoped memo. */
export function createMemoryLegCache(
  seed: Iterable<[string, CachedLeg]> = [],
): LegCache & { entries(): Map<string, CachedLeg> } {
  const store = new Map<string, CachedLeg>(seed);
  return {
    async getFresh(keys, now) {
      const cutoff = cutoffFor(now);
      const found = new Map<string, CachedLeg>();
      for (const key of keys) {
        const id = legKeyId(key);
        const hit = store.get(id);
        if (hit && hit.fetchedAt > cutoff) found.set(id, hit);
      }
      return found;
    },
    async put(legs, now) {
      for (const leg of legs) {
        store.set(legKeyId(leg.key), {
          distanceM: leg.distanceM,
          durationS: leg.durationS,
          geometry: leg.geometry,
          isFlight: leg.isFlight ?? false,
          fetchedAt: now,
        });
      }
    },
    entries: () => store,
  };
}
