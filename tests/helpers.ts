/**
 * Test doubles for the routing core.
 *
 * The Mapbox HTTP layer is faked here, which is what lets the load-bearing
 * chunking tests run with no credentials and no network.
 */

import { encodePolyline, type LngLat } from '@/lib/polyline';
import type { DirectionsResponse, RouteDialect } from '@/lib/routing/chunked-router';
import { runProfile, runToCoordinates } from '@/lib/routing/legs';
import type { SummaryStop } from '@/lib/routing/summary';
import type { TravelProfile } from '@/lib/limits';

export interface RecordedCall {
  relativeUrl: string;
  profile: string;
  coords: LngLat[];
  /** Legs this request covers: coordinates minus one. */
  legCount: number;
  query: URLSearchParams;
}

export interface FakeTransport {
  (relativeUrl: string): Promise<DirectionsResponse>;
  calls: RecordedCall[];
}

export function parseDirectionsPath(relativeUrl: string) {
  const [pathPart, queryPart = ''] = relativeUrl.split('?');
  const segments = pathPart.split('/');
  const coordStr = segments[segments.length - 1];
  const profile = segments.slice(0, -1).join('/');
  const coords: LngLat[] = coordStr.split(';').map((pair) => {
    const [lng, lat] = pair.split(',').map(Number);
    return [lng, lat];
  });
  return { profile, coords, query: new URLSearchParams(queryPart) };
}

/**
 * A minimal dialect for exercising the shared chunking core: the profile is the
 * bare travel mode, so tests are not coupled to any provider's URL shape. The
 * real dialects are covered in providers.test.ts.
 */
export function testDialect(maxLegsPerRequest: number): RouteDialect {
  return {
    name: 'test',
    maxLegsPerRequest,
    supportsProfile: () => true,
    buildPath(chunk) {
      const coords = runToCoordinates(chunk)
        .map((c) => `${c.lng},${c.lat}`)
        .join(';');
      const query = new URLSearchParams({
        geometries: 'polyline6',
        overview: 'full',
        steps: 'true',
        continue_straight: 'false',
      });
      return `${runProfile(chunk)}/${coords}?${query.toString()}`;
    },
  };
}

/**
 * Returns a transport that synthesises a plausible Directions response: one leg
 * per coordinate pair, each leg's geometry a three-point line from its start to
 * its end, so stitched geometry can be checked for contiguity.
 */
export function makeFakeTransport(
  opts: { metresPerLeg?: number; secondsPerLeg?: number } = {},
): FakeTransport {
  const metresPerLeg = opts.metresPerLeg ?? 100_000;
  const secondsPerLeg = opts.secondsPerLeg ?? 3_600;

  const transport = (async (relativeUrl: string) => {
    const { profile, coords, query } = parseDirectionsPath(relativeUrl);
    transport.calls.push({
      relativeUrl,
      profile,
      coords,
      legCount: coords.length - 1,
      query,
    });

    const legs = [];
    for (let i = 0; i < coords.length - 1; i++) {
      const a = coords[i];
      const b = coords[i + 1];
      const mid: LngLat = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      legs.push({
        distance: metresPerLeg,
        duration: secondsPerLeg,
        steps: [
          { geometry: encodePolyline([a, mid]) },
          { geometry: encodePolyline([mid, b]) },
        ],
      });
    }

    return {
      code: 'Ok',
      routes: [
        {
          distance: metresPerLeg * legs.length,
          duration: secondsPerLeg * legs.length,
          legs,
        },
      ],
    } satisfies DirectionsResponse;
  }) as FakeTransport;

  transport.calls = [];
  return transport;
}

/** A chain of distinct stops along a diagonal line. */
export function makeStops(
  count: number,
  opts: { profileToNext?: (i: number) => TravelProfile | null } = {},
): SummaryStop[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `s${i}`,
    lat: 39 + i * 0.1,
    lng: -104 - i * 0.1,
    days: i % 3 === 0 ? 1 : 0,
    profileToNext: opts.profileToNext ? opts.profileToNext(i) : null,
  }));
}

/** Moves one element of an array, returning a new array. */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
