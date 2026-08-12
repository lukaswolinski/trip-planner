/**
 * Provider-neutral chunked routing.
 *
 * Every hosted routing API caps a single request at some number of
 * coordinates, so unlimited stops works by splitting a run of consecutive legs
 * into per-request chunks and splitting each response's `legs[]` array back into
 * individual leg records.
 *
 * This module knows nothing about which provider is in use. A `RouteDialect`
 * supplies the URL shape and the per-request ceiling; a transport performs the
 * HTTP call and attaches any credentials. That split is what makes swapping
 * Mapbox for OSRM a two-file change, and it is why all of this is testable with
 * no credentials and no network.
 *
 * Mapbox Directions v5 is itself derived from OSRM's HTTP API, so the response
 * parsing below is genuinely shared rather than a lowest common denominator:
 * both return `code: "Ok"`, `routes[0].legs[]` with `distance`/`duration`, and
 * per-leg `steps[].geometry`.
 */

import { MAX_SNAP_DISPLACEMENT_M, type TravelProfile } from '@/lib/limits';
import { flightLine, haversineMeters, type Point } from '@/lib/geo';
import {
  decodePolyline,
  encodePolyline,
  joinPointSequences,
  type LngLat,
} from '@/lib/polyline';
import { legKeyId, runToCoordinates, type LegKey, type RoundedCoord } from './legs';

export interface DirectionsStep {
  geometry?: string;
}

/**
 * Where the provider snapped one requested coordinate, as [lng, lat].
 *
 * Both OSRM and Mapbox return this, and it is the only reliable way to detect
 * an unroutable leg — see MAX_SNAP_DISPLACEMENT_M.
 */
export interface DirectionsWaypoint {
  location?: [number, number];
}

export interface DirectionsLeg {
  distance: number;
  duration: number;
  steps?: DirectionsStep[];
}

export interface DirectionsRoute {
  distance: number;
  duration: number;
  geometry?: string;
  legs: DirectionsLeg[];
}

export interface DirectionsResponse {
  code?: string;
  message?: string;
  routes?: DirectionsRoute[];
  waypoints?: DirectionsWaypoint[];
}

/** A single routed leg, ready to be cached. */
export interface LegResult {
  key: LegKey;
  distanceM: number;
  durationS: number;
  /** polyline6 covering just this leg. */
  geometry: string;
  /**
   * True when no road connects these two stops, so this is shown as a flight:
   * straight line, great-circle distance, and no travel time.
   *
   * Cached like any other leg, which matters — it means an unroutable pair is
   * discovered once, not re-attempted on every summary.
   */
  isFlight?: boolean;
}

/**
 * Receives a provider-relative URL (path + query, no credentials) and returns
 * the parsed response. Implemented per provider; faked in tests.
 */
export type DirectionsTransport = (relativeUrl: string) => Promise<DirectionsResponse>;

/** Describes one provider's URL shape and request ceiling. */
export interface RouteDialect {
  name: string;
  /** Max legs in one request. One fewer than the coordinate ceiling. */
  maxLegsPerRequest: number;
  /**
   * Builds the path and query for one chunk, relative to the provider base.
   * Must request polyline6 geometry and per-leg steps.
   */
  buildPath(chunk: readonly LegKey[]): string;
  /** True when this provider genuinely routes the given profile. */
  supportsProfile(profile: TravelProfile): boolean;
}

export interface Router {
  /** Fetches every leg in every run, preserving order within each run. */
  fetchRuns(runs: readonly LegKey[][]): Promise<LegResult[]>;
}

/**
 * Splits one contiguous run into requests of at most `maxLegs` legs.
 *
 * Chunks deliberately do NOT overlap: leg boundaries already coincide, so
 * chunking a 30-leg run into 24 + 6 covers all 30 legs exactly once. The
 * coordinate lists overlap by the shared seam stop, which is what keeps the legs
 * contiguous.
 */
export function chunkRun(run: readonly LegKey[], maxLegs: number): LegKey[][] {
  if (maxLegs < 1) throw new Error('maxLegs must be at least 1');
  const chunks: LegKey[][] = [];
  for (let i = 0; i < run.length; i += maxLegs) {
    chunks.push(run.slice(i, i + maxLegs));
  }
  return chunks;
}

function toPoint(coord: RoundedCoord): Point {
  return { lat: Number(coord.lat), lng: Number(coord.lng) };
}

/**
 * A leg with no road connection: great-circle distance, a two-point straight
 * line, and explicitly **no duration**.
 *
 * Duration is 0 rather than a guess. We know the distance precisely and the
 * travel time not at all, and inventing a flight time (which would depend on
 * schedules, layovers and airports we know nothing about) would be a fabricated
 * number sitting in a total that otherwise means something.
 */
export function flightLegResult(key: LegKey): LegResult {
  const from = toPoint(key.from);
  const to = toPoint(key.to);
  return {
    key,
    distanceM: Math.round(haversineMeters(from, to)),
    durationS: 0,
    geometry: encodePolyline(flightLine(from, to)),
    isFlight: true,
  };
}

/**
 * Indices of requested coordinates the provider moved implausibly far.
 *
 * A provider that cannot reach a coordinate does not necessarily say so: OSRM
 * picks the nearest snap candidate *reachable from the origin*, which for a
 * transatlantic request meant answering "Ok" after quietly relocating New York
 * to Portugal. Comparing what we asked for against `waypoints[].location` is
 * what catches that.
 *
 * Returns an empty set when the provider omits `waypoints`, so a provider that
 * does not report snapping degrades to error-code detection alone rather than
 * flagging everything.
 */
export function displacedWaypoints(
  chunk: readonly LegKey[],
  response: DirectionsResponse,
  maxDisplacementM: number = MAX_SNAP_DISPLACEMENT_M,
): Set<number> {
  const displaced = new Set<number>();
  const waypoints = response.waypoints;
  if (!waypoints?.length) return displaced;

  const requested = runToCoordinates(chunk);
  for (let i = 0; i < requested.length; i++) {
    const location = waypoints[i]?.location;
    if (!location) continue;
    const [lng, lat] = location;
    if (haversineMeters(toPoint(requested[i]), { lat, lng }) > maxDisplacementM) {
      displaced.add(i);
    }
  }
  return displaced;
}

/** Concatenates a leg's step geometries into one polyline6 string. */
export function legGeometry(leg: DirectionsLeg): string {
  const sequences: LngLat[][] = (leg.steps ?? [])
    .map((s) => s.geometry)
    .filter((g): g is string => typeof g === 'string' && g.length > 0)
    .map((g) => decodePolyline(g));
  return encodePolyline(joinPointSequences(sequences));
}

/** Response codes that mean "these points cannot be connected by road". */
const NO_ROUTE_CODES = new Set(['NoRoute', 'NoSegment', 'NoMatch']);

export function createChunkedRouter(
  dialect: RouteDialect,
  transport: DirectionsTransport,
): Router {
  /**
   * Fetches one chunk, isolating unroutable legs by bisection.
   *
   * When a provider rejects a whole request with `NoRoute` it does not say
   * *which* pair broke it, so a 99-leg chunk containing one ocean crossing
   * fails entirely. Halving the chunk and retrying narrows it down in about
   * 2·log₂(n) requests — roughly 14 for a full chunk — and only on the rare
   * path where something is genuinely unroutable. Retrying leg-by-leg instead
   * would cost 99 requests against a one-per-second courtesy limit.
   */
  async function fetchChunk(chunk: readonly LegKey[]): Promise<LegResult[]> {
    try {
      const response = await transport(dialect.buildPath(chunk));
      return mapChunkResponse(chunk, response);
    } catch (error) {
      const refused =
        error instanceof RoutingProviderError && NO_ROUTE_CODES.has(error.code);
      if (!refused) throw error;

      // Down to one leg, so the refusal is unambiguous: this pair has no road
      // between it. Show it as a flight rather than failing the whole trip.
      if (chunk.length === 1) return [flightLegResult(chunk[0])];

      const mid = Math.ceil(chunk.length / 2);
      const [left, right] = [chunk.slice(0, mid), chunk.slice(mid)];
      return [...(await fetchChunk(left)), ...(await fetchChunk(right))];
    }
  }

  return {
    async fetchRuns(runs) {
      const results: LegResult[] = [];

      for (const run of runs) {
        if (run.length === 0) continue;

        // Fail loudly rather than returning a driving time labelled as walking.
        const profile = run[0].profile;
        if (!dialect.supportsProfile(profile)) {
          throw new RoutingProviderError(
            `Routing provider "${dialect.name}" does not support the ${profile} profile`,
            'UnsupportedProfile',
          );
        }

        for (const chunk of chunkRun(run, dialect.maxLegsPerRequest)) {
          results.push(...(await fetchChunk(chunk)));
        }
      }

      return results;
    },
  };
}

/**
 * Splits one response back into per-leg records.
 *
 * The leg-count assertion matters: if a provider ever returned a different
 * number of legs than we asked for, silently zipping them would misattribute
 * distances to the wrong stops — wrong totals that still look plausible.
 */
export function mapChunkResponse(
  chunk: readonly LegKey[],
  response: DirectionsResponse,
  maxDisplacementM: number = MAX_SNAP_DISPLACEMENT_M,
): LegResult[] {
  if (response.code && response.code !== 'Ok') {
    throw new RoutingProviderError(
      response.message ?? `Routing API returned code ${response.code}`,
      response.code,
    );
  }

  const route = response.routes?.[0];
  if (!route) {
    throw new RoutingProviderError('Routing API returned no route', 'NoRoute');
  }
  if (route.legs.length !== chunk.length) {
    throw new RoutingProviderError(
      `Routing API returned ${route.legs.length} legs for ${chunk.length} requested ` +
        `(first leg ${legKeyId(chunk[0])})`,
      'LegCountMismatch',
    );
  }

  // A coordinate the provider relocated makes both legs touching it fiction —
  // but legs between two properly-snapped coordinates are still genuine, so
  // only the affected legs become flights.
  const displaced = displacedWaypoints(chunk, response, maxDisplacementM);

  return chunk.map((key, i) => {
    if (displaced.has(i) || displaced.has(i + 1)) return flightLegResult(key);
    const leg = route.legs[i];
    return {
      key,
      distanceM: Math.round(leg.distance),
      durationS: Math.round(leg.duration),
      geometry: legGeometry(leg),
    };
  });
}

export class RoutingProviderError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'RoutingProviderError';
  }
}

/** Thrown when a provider is selected but its credentials are absent. */
export class RoutingNotConfiguredError extends Error {
  constructor(readonly variable: string) {
    super(
      `${variable} is not set. Copy .env.example to .env.local and fill it in.`,
    );
    this.name = 'RoutingNotConfiguredError';
  }
}

/**
 * The provider could not be reached at all — DNS failure, connection timeout,
 * reset socket.
 *
 * Distinct from RoutingProviderError (the provider answered, but said no) so the
 * UI can tell "this trip cannot be routed" apart from "the routing service is
 * down". The OSRM demo servers offer no uptime guarantee, so this is a normal
 * operating condition rather than an exceptional one.
 */
export class RoutingUnreachableError extends Error {
  constructor(
    readonly provider: string,
    cause?: unknown,
  ) {
    super(`Routing provider "${provider}" is unreachable`);
    this.name = 'RoutingUnreachableError';
    this.cause = cause;
  }
}

/** True for the network-level failures `fetch` reports as a generic TypeError. */
export function isNetworkFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const codes = ['UND_ERR_CONNECT_TIMEOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET'];
  const cause = (error as { cause?: { code?: string } }).cause;
  if (cause?.code && codes.includes(cause.code)) return true;
  return error.name === 'TypeError' && /fetch failed/i.test(error.message);
}
