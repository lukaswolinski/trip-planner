/**
 * Unroutable legs become flight legs.
 *
 * Two failure shapes are covered, because the providers produce both and the
 * second is the dangerous one:
 *
 * 1. **The provider refuses.** OSRM answers `NoRoute` for the whole request
 *    without saying which pair caused it, so the router bisects to isolate.
 * 2. **The provider lies.** Verified against the live OSRM demo server: Paris →
 *    New York returns `code: "Ok"` and a confident 1777 km, having silently
 *    snapped New York to a road near Lisbon 5391 km away. Only the reported
 *    snap location reveals this, so a displaced waypoint is treated as proof
 *    that no route exists.
 */

import { describe, expect, it } from 'vitest';
import {
  createChunkedRouter,
  displacedWaypoints,
  flightLegResult,
  mapChunkResponse,
  type DirectionsResponse,
} from '@/lib/routing/chunked-router';
import { createMemoryLegCache } from '@/lib/routing/cache';
import { legKeysForStops, roundCoord } from '@/lib/routing/legs';
import { buildTripSummary, splitSegments, type SummaryLeg } from '@/lib/routing/summary';
import { haversineMeters, unwrapLongitude } from '@/lib/geo';
import { decodePolyline } from '@/lib/polyline';
import { makeFakeTransport, testDialect } from './helpers';

const PARIS = { lat: 48.8566, lng: 2.3522 };
const NEW_YORK = { lat: 40.7128, lng: -74.006 };
/** Where the live demo server actually snapped New York — a road near Lisbon. */
const LISBON_SNAP: [number, number] = [-9.4977, 38.7807];

/** Paris, New York, Boston: one ocean crossing in the middle of a road trip. */
function transatlanticStops() {
  return [
    { id: 'paris', ...PARIS, days: 2 },
    { id: 'nyc', ...NEW_YORK, days: 1 },
    { id: 'boston', lat: 42.3601, lng: -71.0589, days: 1 },
  ];
}

const isOceanCrossing = (a: [number, number], b: [number, number]): boolean =>
  Math.sign(a[0]) !== Math.sign(b[0]) && Math.abs(a[0] - b[0]) > 40;

describe('great-circle geometry', () => {
  it('measures a known distance', () => {
    // Paris–New York is ~5837 km; allow 1% for radius-model differences.
    const km = haversineMeters(PARIS, NEW_YORK) / 1000;
    expect(km).toBeGreaterThan(5780);
    expect(km).toBeLessThan(5890);
  });

  it('is zero for a point to itself and symmetric', () => {
    expect(haversineMeters(PARIS, PARIS)).toBe(0);
    expect(haversineMeters(PARIS, NEW_YORK)).toBeCloseTo(
      haversineMeters(NEW_YORK, PARIS),
      6,
    );
  });

  it('draws a Pacific crossing the short way round', () => {
    // Tokyo 139.7E to Los Angeles 118.2W. Naively that is 257 degrees westward
    // across Asia and Europe; unwrapped it is 103 degrees east across the
    // Pacific, which is the actual short way.
    expect(unwrapLongitude(-118.2437, 139.6917)).toBeCloseTo(241.7563, 4);
    expect(Math.abs(241.7563 - 139.6917)).toBeLessThan(180);
  });
});

describe('detecting an unroutable leg', () => {
  it('flags a waypoint the provider relocated to another continent', () => {
    const chunk = legKeysForStops(
      [
        { id: 'a', ...PARIS },
        { id: 'b', ...NEW_YORK },
      ],
      'driving',
    );
    const response: DirectionsResponse = {
      code: 'Ok',
      waypoints: [{ location: [PARIS.lng, PARIS.lat] }, { location: LISBON_SNAP }],
      routes: [{ distance: 1_777_000, duration: 64_000, legs: [{ distance: 1_777_000, duration: 64_000 }] }],
    };

    expect([...displacedWaypoints(chunk, response)]).toEqual([1]);
  });

  it('accepts the small snap a genuine route produces', () => {
    const chunk = legKeysForStops(
      [
        { id: 'a', ...PARIS },
        { id: 'b', lat: 52.52, lng: 13.405 },
      ],
      'driving',
    );
    // Both moved ~100 m onto the nearest road, as Paris->Berlin really does.
    const response: DirectionsResponse = {
      code: 'Ok',
      waypoints: [{ location: [2.3523, 48.8572] }, { location: [13.405, 52.52] }],
      routes: [{ distance: 1_051_000, duration: 38_000, legs: [{ distance: 1_051_000, duration: 38_000 }] }],
    };

    expect(displacedWaypoints(chunk, response).size).toBe(0);
  });

  it('replaces a lied-about leg with great-circle distance and no duration', () => {
    const chunk = legKeysForStops(
      [
        { id: 'a', ...PARIS },
        { id: 'b', ...NEW_YORK },
      ],
      'driving',
    );
    const legs = mapChunkResponse(chunk, {
      code: 'Ok',
      waypoints: [{ location: [PARIS.lng, PARIS.lat] }, { location: LISBON_SNAP }],
      routes: [{ distance: 1_777_000, duration: 64_000, legs: [{ distance: 1_777_000, duration: 64_000 }] }],
    });

    expect(legs).toHaveLength(1);
    expect(legs[0].isFlight).toBe(true);
    expect(legs[0].durationS).toBe(0);
    // The provider's 1777 km is discarded in favour of the real 5837 km.
    expect(legs[0].distanceM / 1000).toBeGreaterThan(5780);
  });

  it('keeps genuine legs either side of a displaced waypoint', () => {
    // Four stops where only the third is unreachable: legs 2 and 3 touch it,
    // leg 1 does not and must keep its routed figures.
    const chunk = legKeysForStops(
      [
        { id: 'a', lat: 48.85, lng: 2.35 },
        { id: 'b', lat: 50.85, lng: 4.35 },
        { id: 'c', ...NEW_YORK },
        { id: 'd', lat: 42.36, lng: -71.06 },
      ],
      'driving',
    );
    const legs = mapChunkResponse(chunk, {
      code: 'Ok',
      waypoints: [
        { location: [2.35, 48.85] },
        { location: [4.35, 50.85] },
        { location: LISBON_SNAP },
        { location: [-71.06, 42.36] },
      ],
      routes: [
        {
          distance: 0,
          duration: 0,
          legs: [
            { distance: 300_000, duration: 11_000 },
            { distance: 1_700_000, duration: 60_000 },
            { distance: 1_500_000, duration: 55_000 },
          ],
        },
      ],
    });

    expect(legs.map((l) => l.isFlight ?? false)).toEqual([false, true, true]);
    expect(legs[0].distanceM).toBe(300_000);
    expect(legs[0].durationS).toBe(11_000);
  });

  it('has no opinion when the provider reports no waypoints at all', () => {
    const chunk = legKeysForStops(
      [
        { id: 'a', ...PARIS },
        { id: 'b', ...NEW_YORK },
      ],
      'driving',
    );
    expect(displacedWaypoints(chunk, { code: 'Ok' }).size).toBe(0);
  });
});

describe('isolating a refused leg by bisection', () => {
  it('turns the one unroutable pair into a flight and keeps the rest routed', async () => {
    const transport = makeFakeTransport({ unroutable: isOceanCrossing });
    const router = createChunkedRouter(testDialect(24), transport);
    const cache = createMemoryLegCache();

    const summary = await buildTripSummary(transatlanticStops(), 'driving', {
      cache,
      router,
    });

    expect(summary.legs.map((l) => l.isFlight)).toEqual([true, false]);
    expect(summary.flightLegCount).toBe(1);
    // The drive total covers only the American leg.
    expect(summary.totalDistanceM).toBe(100_000);
    expect(summary.totalFlightDistanceM / 1000).toBeGreaterThan(5780);
  });

  it('finds a single bad leg in a long chunk without one request per leg', async () => {
    const transport = makeFakeTransport({ unroutable: isOceanCrossing });
    const router = createChunkedRouter(testDialect(99), transport);
    const cache = createMemoryLegCache();

    // 40 stops, with the ocean crossing halfway through.
    const stops = Array.from({ length: 40 }, (_, i) => ({
      id: `s${i}`,
      lat: 40 + i * 0.1,
      lng: i < 20 ? 2 + i * 0.1 : -74 + (i - 20) * 0.1,
      days: 0,
    }));

    const summary = await buildTripSummary(stops, 'driving', { cache, router });

    expect(summary.flightLegCount).toBe(1);
    expect(summary.legs.filter((l) => l.isFlight)).toHaveLength(1);
    expect(summary.legs[19].isFlight).toBe(true);
    // Bisection, not one request per leg: ~2*log2(39) is far below 39.
    expect(transport.calls.length).toBeLessThan(20);
    expect(summary.legs.filter((l) => !l.isFlight)).toHaveLength(38);
  });

  it('caches the flight verdict so it is not rediscovered', async () => {
    const transport = makeFakeTransport({ unroutable: isOceanCrossing });
    const router = createChunkedRouter(testDialect(24), transport);
    const cache = createMemoryLegCache();
    const stops = transatlanticStops();

    await buildTripSummary(stops, 'driving', { cache, router });
    const firstPass = transport.calls.length;
    expect(firstPass).toBeGreaterThan(0);

    const second = await buildTripSummary(stops, 'driving', { cache, router });

    expect(transport.calls.length).toBe(firstPass); // no further requests
    expect(second.legs.map((l) => l.isFlight)).toEqual([true, false]);
    expect(second.flightLegCount).toBe(1);
  });
});

describe('map geometry around a flight', () => {
  const leg = (isFlight: boolean, geometry: string): SummaryLeg => ({
    fromStopId: 'a',
    toStopId: 'b',
    profile: 'driving',
    distanceM: 1,
    durationS: 1,
    geometry,
    fetchedAt: new Date(),
    isFlight,
  });

  it('breaks the road line either side of a flight instead of stitching across', () => {
    const flight = flightLegResult({
      profile: 'driving',
      from: roundCoord(PARIS.lat, PARIS.lng),
      to: roundCoord(NEW_YORK.lat, NEW_YORK.lng),
    });

    const { roadSegments, flightSegments } = splitSegments([
      leg(false, '_c`|@_c`|@_ibE_ibE'),
      leg(true, flight.geometry),
      leg(false, '_c`|@_c`|@_ibE_ibE'),
    ]);

    // Two separate drivable runs, not one line crossing the Atlantic.
    expect(roadSegments).toHaveLength(2);
    expect(flightSegments).toHaveLength(1);
    expect(flightSegments[0]).toHaveLength(2);
  });

  it('draws the flight as exactly two points between the stops', () => {
    const flight = flightLegResult({
      profile: 'driving',
      from: roundCoord(PARIS.lat, PARIS.lng),
      to: roundCoord(NEW_YORK.lat, NEW_YORK.lng),
    });
    const line = decodePolyline(flight.geometry);

    expect(line).toHaveLength(2);
    expect(line[0][0]).toBeCloseTo(PARIS.lng, 4);
    expect(line[0][1]).toBeCloseTo(PARIS.lat, 4);
    expect(line[1][0]).toBeCloseTo(NEW_YORK.lng, 4);
    expect(line[1][1]).toBeCloseTo(NEW_YORK.lat, 4);
  });

  it('leaves an all-road trip as a single unbroken run', () => {
    const { roadSegments, flightSegments } = splitSegments([
      leg(false, '_c`|@_c`|@_ibE_ibE'),
      leg(false, '_c`|@_c`|@_ibE_ibE'),
    ]);
    expect(roadSegments).toHaveLength(1);
    expect(flightSegments).toEqual([]);
  });
});
