/**
 * Trip summary: cache-fill orchestration, totals, and the stitched polyline.
 *
 * The totals here are exact, not approximate. Summing consecutive legs is
 * precisely what a single 250-waypoint Directions call would have returned, had
 * any provider offered one.
 */

import type { TravelProfile } from '@/lib/limits';
import type { LegResult } from './chunked-router';
import { stitchEncoded, type LngLat } from '@/lib/polyline';
import type { LegCache } from './cache';
import {
  groupConsecutive,
  legKeyId,
  legKeysForStops,
  splitRunByProfile,
  type LegKey,
  type StopPoint,
} from './legs';

export interface SummaryStop extends StopPoint {
  days?: number;
}

export interface SummaryLeg {
  fromStopId: string;
  toStopId: string;
  profile: TravelProfile;
  distanceM: number;
  durationS: number;
  /** polyline6 for this leg alone. */
  geometry: string;
  fetchedAt: Date;
}

export interface TripSummary {
  legs: SummaryLeg[];
  totalDistanceM: number;
  totalDurationS: number;
  /** Sum of per-stop `days`. */
  totalNights: number;
  stopCount: number;
  /** Whole-trip line in GeoJSON [lng, lat] order, ready for Mapbox GL. */
  geometry: LngLat[];
  /**
   * Oldest `fetched_at` across the trip's legs — drives the "estimates updated
   * N days ago" label. Null when the trip has no legs.
   */
  estimatesFetchedAt: Date | null;
  /** Legs the trip needs in total. */
  legCount: number;
  /** Legs that had to be fetched from the provider on this call. */
  fetchedLegCount: number;
  /**
   * True when some legs had no cached data and `allowMissingLegs` was set, so
   * the totals cover only part of the trip. Callers must not present a partial
   * total as if it were complete.
   */
  partial: boolean;
}

export interface SummaryDeps {
  cache: LegCache;
  router: { fetchRuns(runs: readonly LegKey[][]): Promise<LegResult[]> };
  now?: Date;
  /**
   * Tolerate legs with no data instead of throwing.
   *
   * Used by the public share page: it first summarises cache-only, and only
   * spends a rate-limit token on a real provider call if something is actually
   * missing. Without this, every visitor to a shared trip whose legs had
   * expired would trigger routing calls.
   */
  allowMissingLegs?: boolean;
}

/** A router that fetches nothing — for cache-only summaries. */
export const nullRouter = {
  async fetchRuns(): Promise<LegResult[]> {
    return [];
  },
};

export async function buildTripSummary(
  stops: readonly SummaryStop[],
  defaultProfile: TravelProfile,
  deps: SummaryDeps,
): Promise<TripSummary> {
  const now = deps.now ?? new Date();
  const totalNights = stops.reduce((sum, s) => sum + (s.days ?? 0), 0);

  const keys = legKeysForStops(stops, defaultProfile);

  if (keys.length === 0) {
    return {
      legs: [],
      totalDistanceM: 0,
      totalDurationS: 0,
      totalNights,
      stopCount: stops.length,
      geometry: [],
      estimatesFetchedAt: null,
      legCount: 0,
      fetchedLegCount: 0,
      partial: false,
    };
  }

  const cached = await deps.cache.getFresh(keys, now);

  // Indices of legs we still need. Consecutive runs of these become one
  // multi-coordinate request each; a run is further split wherever the travel
  // profile changes, since one request carries one profile.
  const missingIndices: number[] = [];
  for (let i = 0; i < keys.length; i++) {
    if (!cached.has(legKeyId(keys[i]))) missingIndices.push(i);
  }

  let fetched: LegResult[] = [];
  if (missingIndices.length > 0) {
    const runs = groupConsecutive(missingIndices)
      .map((run) => run.map((i) => keys[i]))
      .flatMap((run) => splitRunByProfile(run));

    fetched = await deps.router.fetchRuns(runs);
    await deps.cache.put(fetched, now);
  }

  const fetchedById = new Map<string, LegResult>();
  for (const leg of fetched) fetchedById.set(legKeyId(leg.key), leg);

  const legs: SummaryLeg[] = [];
  let totalDistanceM = 0;
  let totalDurationS = 0;
  let oldest: Date | null = null;
  let partial = false;

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const id = legKeyId(key);
    const hit = cached.get(id);
    const fresh = fetchedById.get(id);

    const distanceM = hit?.distanceM ?? fresh?.distanceM;
    const durationS = hit?.durationS ?? fresh?.durationS;
    const geometry = hit?.geometry ?? fresh?.geometry;
    const fetchedAt = hit?.fetchedAt ?? (fresh ? now : undefined);

    if (
      distanceM === undefined ||
      durationS === undefined ||
      geometry === undefined ||
      fetchedAt === undefined
    ) {
      if (deps.allowMissingLegs) {
        partial = true;
        continue;
      }
      // Neither cached nor returned by the provider. Failing loudly beats
      // reporting a total that quietly omits a leg.
      throw new Error(`Routing produced no result for leg ${id}`);
    }

    legs.push({
      fromStopId: stops[i].id,
      toStopId: stops[i + 1].id,
      profile: key.profile,
      distanceM,
      durationS,
      geometry,
      fetchedAt,
    });

    totalDistanceM += distanceM;
    totalDurationS += durationS;
    if (oldest === null || fetchedAt < oldest) oldest = fetchedAt;
  }

  return {
    legs,
    totalDistanceM,
    totalDurationS,
    totalNights,
    stopCount: stops.length,
    geometry: stitchEncoded(legs.map((l) => l.geometry)),
    estimatesFetchedAt: oldest,
    legCount: keys.length,
    fetchedLegCount: fetched.length,
    partial,
  };
}
