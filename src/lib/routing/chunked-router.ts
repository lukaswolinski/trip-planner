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

import type { TravelProfile } from '@/lib/limits';
import {
  decodePolyline,
  encodePolyline,
  joinPointSequences,
  type LngLat,
} from '@/lib/polyline';
import { legKeyId, type LegKey } from './legs';

export interface DirectionsStep {
  geometry?: string;
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
}

/** A single routed leg, ready to be cached. */
export interface LegResult {
  key: LegKey;
  distanceM: number;
  durationS: number;
  /** polyline6 covering just this leg. */
  geometry: string;
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

/** Concatenates a leg's step geometries into one polyline6 string. */
export function legGeometry(leg: DirectionsLeg): string {
  const sequences: LngLat[][] = (leg.steps ?? [])
    .map((s) => s.geometry)
    .filter((g): g is string => typeof g === 'string' && g.length > 0)
    .map((g) => decodePolyline(g));
  return encodePolyline(joinPointSequences(sequences));
}

export function createChunkedRouter(
  dialect: RouteDialect,
  transport: DirectionsTransport,
): Router {
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
          const response = await transport(dialect.buildPath(chunk));
          results.push(...mapChunkResponse(chunk, response));
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

  return chunk.map((key, i) => {
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
