/**
 * Turning a trip into legs, and grouping the missing ones into fetchable runs.
 *
 * This module is pure — no database, no network, no environment. It is the
 * piece that makes unlimited stops possible, so it is also the piece that gets
 * tested hardest.
 */

import { COORD_PRECISION, type TravelProfile } from '@/lib/limits';

/** The minimum a stop needs to expose for routing purposes. */
export interface StopPoint {
  id: string;
  lat: number;
  lng: number;
  /** Travel mode from this stop to the next; null means the trip default. */
  profileToNext?: TravelProfile | null;
}

/** A coordinate rounded to cache-key precision, held as canonical strings. */
export interface RoundedCoord {
  lat: string;
  lng: string;
}

export interface LegKey {
  profile: TravelProfile;
  from: RoundedCoord;
  to: RoundedCoord;
}

/**
 * Rounds to 5 decimal places (~1.1 m) so that two stops a user placed at
 * imperceptibly different points still share a cached leg. Also normalises
 * -0 to 0, which would otherwise produce two spellings of the same key.
 */
export function roundCoord(lat: number, lng: number): RoundedCoord {
  return {
    lat: normalize(lat),
    lng: normalize(lng),
  };
}

function normalize(n: number): string {
  const fixed = n.toFixed(COORD_PRECISION);
  return fixed === '-0.00000' ? '0.00000' : fixed;
}

/** Stable string form of a leg key, for use as a Map key. */
export function legKeyId(key: LegKey): string {
  return `${key.profile}|${key.from.lat},${key.from.lng}|${key.to.lat},${key.to.lng}`;
}

export function coordsEqual(a: RoundedCoord, b: RoundedCoord): boolean {
  return a.lat === b.lat && a.lng === b.lng;
}

/**
 * A trip of N stops is N-1 legs. Each leg's profile comes from the stop it
 * departs from, falling back to the trip default.
 */
export function legKeysForStops(
  stops: readonly StopPoint[],
  defaultProfile: TravelProfile,
): LegKey[] {
  const keys: LegKey[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i];
    const to = stops[i + 1];
    keys.push({
      profile: from.profileToNext ?? defaultProfile,
      from: roundCoord(from.lat, from.lng),
      to: roundCoord(to.lat, to.lng),
    });
  }
  return keys;
}

/**
 * Groups ascending indices into maximal consecutive runs:
 * [0,1,2,5,6,9] -> [[0,1,2],[5,6],[9]]
 *
 * Consecutive legs share endpoints, which is exactly what lets a run be fetched
 * as one multi-coordinate Directions request instead of one request per leg.
 */
export function groupConsecutive(indices: readonly number[]): number[][] {
  const runs: number[][] = [];
  let current: number[] = [];

  for (const index of indices) {
    if (current.length === 0 || index === current[current.length - 1] + 1) {
      current.push(index);
    } else {
      runs.push(current);
      current = [index];
    }
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/**
 * A run of consecutive legs, expressed as the coordinate chain a Directions
 * request needs: k legs become k+1 coordinates.
 *
 * Throws if the legs do not actually chain, since silently routing a broken
 * chain would produce plausible-looking but wrong distances.
 */
export function runToCoordinates(run: readonly LegKey[]): RoundedCoord[] {
  if (run.length === 0) return [];
  const coords: RoundedCoord[] = [run[0].from];
  for (let i = 0; i < run.length; i++) {
    if (i > 0 && !coordsEqual(run[i].from, run[i - 1].to)) {
      throw new Error(
        `Leg run is not contiguous at index ${i}: ` +
          `${legKeyId(run[i - 1])} does not end where ${legKeyId(run[i])} begins`,
      );
    }
    coords.push(run[i].to);
  }
  return coords;
}

/** All legs in a run must share a profile — a single request has one profile. */
export function runProfile(run: readonly LegKey[]): TravelProfile {
  const profile = run[0].profile;
  for (const leg of run) {
    if (leg.profile !== profile) {
      throw new Error('Leg run mixes travel profiles; split it before fetching');
    }
  }
  return profile;
}

/**
 * Splits a run of consecutive legs wherever the travel profile changes, so each
 * resulting run can go out as a single-profile request.
 */
export function splitRunByProfile(run: readonly LegKey[]): LegKey[][] {
  const out: LegKey[][] = [];
  let current: LegKey[] = [];
  for (const leg of run) {
    if (current.length > 0 && current[current.length - 1].profile !== leg.profile) {
      out.push(current);
      current = [];
    }
    current.push(leg);
  }
  if (current.length > 0) out.push(current);
  return out;
}
