/**
 * The load-bearing proof of the differentiator.
 *
 * Google Maps caps a route at 10 stops; every hosted routing API caps a single
 * request at some coordinate ceiling. These tests assert that a 60-stop trip is
 * routed in a handful of requests rather than one per leg, that reordering
 * re-fetches only what actually changed, and that an expired cache entry is
 * treated as a miss.
 *
 * The dialect is parameterised, so the same guarantees are checked against both
 * the Mapbox (24 legs/request) and OSRM (99 legs/request) shapes.
 */

import { describe, expect, it } from 'vitest';
import {
  chunkRun,
  createChunkedRouter,
  mapChunkResponse,
  type RouteDialect,
} from '@/lib/routing/chunked-router';
import { createMemoryLegCache, cutoffFor } from '@/lib/routing/cache';
import {
  groupConsecutive,
  legKeyId,
  legKeysForStops,
  roundCoord,
  runToCoordinates,
  splitRunByProfile,
} from '@/lib/routing/legs';
import { buildTripSummary } from '@/lib/routing/summary';
import { makeFakeTransport, makeStops, moveItem, testDialect } from './helpers';

function setup(maxLegs = 24) {
  const transport = makeFakeTransport();
  const dialect: RouteDialect = testDialect(maxLegs);
  const router = createChunkedRouter(dialect, transport);
  const cache = createMemoryLegCache();
  return { transport, router, cache, dialect };
}

describe('leg derivation', () => {
  it('turns N stops into N-1 legs', () => {
    expect(legKeysForStops(makeStops(60), 'driving')).toHaveLength(59);
    expect(legKeysForStops(makeStops(2), 'driving')).toHaveLength(1);
    expect(legKeysForStops(makeStops(1), 'driving')).toHaveLength(0);
    expect(legKeysForStops([], 'driving')).toHaveLength(0);
  });

  it('resolves each leg profile from the stop it departs', () => {
    const stops = makeStops(3, { profileToNext: (i) => (i === 1 ? 'walking' : null) });
    const keys = legKeysForStops(stops, 'driving');
    expect(keys.map((k) => k.profile)).toEqual(['driving', 'walking']);
  });

  it('normalises -0 so one coordinate has one cache key', () => {
    expect(roundCoord(-0, -0)).toEqual({ lat: '0.00000', lng: '0.00000' });
    expect(legKeyId({ profile: 'driving', from: roundCoord(0, 0), to: roundCoord(1, 1) })).toBe(
      'driving|0.00000,0.00000|1.00000,1.00000',
    );
  });

  it('rounds to ~1.1m so imperceptibly different points share a leg', () => {
    expect(roundCoord(39.1234561, -104.9876541)).toEqual(
      roundCoord(39.1234559, -104.9876539),
    );
  });
});

describe('run grouping and chunking', () => {
  it('groups only consecutive indices', () => {
    expect(groupConsecutive([0, 1, 2, 5, 6, 9])).toEqual([[0, 1, 2], [5, 6], [9]]);
    expect(groupConsecutive([])).toEqual([]);
    expect(groupConsecutive([7])).toEqual([[7]]);
  });

  it('chunks a run at the provider ceiling', () => {
    const run = legKeysForStops(makeStops(60), 'driving');
    expect(chunkRun(run, 24).map((c) => c.length)).toEqual([24, 24, 11]);
    // Every leg is covered exactly once.
    expect(chunkRun(run, 24).flat()).toHaveLength(run.length);
    // A higher ceiling means fewer requests for the same trip.
    expect(chunkRun(run, 99).map((c) => c.length)).toEqual([59]);
  });

  it('produces k+1 coordinates for k legs, and rejects a broken chain', () => {
    const run = legKeysForStops(makeStops(25), 'driving');
    expect(runToCoordinates(run)).toHaveLength(25);

    const broken = [run[0], run[5]];
    expect(() => runToCoordinates(broken)).toThrow(/not contiguous/);
  });

  it('splits a run wherever the travel profile changes', () => {
    const stops = makeStops(5, {
      profileToNext: (i) => (i === 2 ? 'walking' : null),
    });
    const run = legKeysForStops(stops, 'driving');
    expect(splitRunByProfile(run).map((r) => r.length)).toEqual([2, 1, 1]);
  });
});

describe('unlimited stops: request economy', () => {
  it('routes a 60-stop trip in 3 requests at the Mapbox ceiling, not 59', async () => {
    const { transport, router, cache } = setup(24);
    const stops = makeStops(60);

    const summary = await buildTripSummary(stops, 'driving', { cache, router });

    expect(summary.legCount).toBe(59);
    expect(transport.calls).toHaveLength(3);
    expect(transport.calls.map((c) => c.legCount)).toEqual([24, 24, 11]);
    for (const call of transport.calls) {
      expect(call.coords.length).toBeLessThanOrEqual(25);
    }
    expect(summary.legs).toHaveLength(59);
  });

  it('routes the same trip in 1 request at the OSRM ceiling', async () => {
    // OSRM's demo server accepted 120 coordinates in testing, so the same trip
    // costs a single request — which matters when the courtesy limit is one
    // request per second.
    const { transport, router, cache } = setup(99);
    const summary = await buildTripSummary(makeStops(60), 'driving', { cache, router });

    expect(summary.legCount).toBe(59);
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].coords).toHaveLength(60);
  });

  it('sends steps=true, without which per-leg geometry would not exist', async () => {
    const { transport, router, cache } = setup();
    await buildTripSummary(makeStops(5), 'driving', { cache, router });
    expect(transport.calls[0].query.get('steps')).toBe('true');
    expect(transport.calls[0].query.get('geometries')).toBe('polyline6');
  });

  it('issues zero requests when every leg is already cached', async () => {
    const { transport, router, cache } = setup();
    const stops = makeStops(60);

    await buildTripSummary(stops, 'driving', { cache, router });
    expect(transport.calls).toHaveLength(3);

    const second = await buildTripSummary(stops, 'driving', { cache, router });
    expect(transport.calls).toHaveLength(3); // unchanged
    expect(second.fetchedLegCount).toBe(0);
    expect(second.totalDistanceM).toBeGreaterThan(0);
  });

  it('re-fetches only the legs a reorder actually changed', async () => {
    const { transport, router, cache } = setup();
    const stops = makeStops(60);

    await buildTripSummary(stops, 'driving', { cache, router });
    const callsAfterWarm = transport.calls.length;

    // Drag stop 30 up to position 5.
    const reordered = moveItem(stops, 30, 5);
    const summary = await buildTripSummary(reordered, 'driving', { cache, router });

    // Three legs change: the gap left behind closes into one new leg, and the
    // insertion point splits one leg into two.
    expect(summary.fetchedLegCount).toBe(3);

    // Those three legs are not adjacent to each other, so they cannot share a
    // request: a routing request must describe one contiguous path. Two
    // requests for 3 legs, against 59 legs in the trip.
    const newCalls = transport.calls.slice(callsAfterWarm);
    expect(newCalls).toHaveLength(2);
    expect(newCalls.map((c) => c.legCount).sort()).toEqual([1, 2]);
  });

  it('needs one request for a trip at exactly the coordinate ceiling', async () => {
    const { transport, router, cache } = setup(24);
    await buildTripSummary(makeStops(25), 'driving', { cache, router });
    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0].coords).toHaveLength(25);
  });
});

describe('cache TTL', () => {
  it('treats a 31-day-old leg as a miss and refetches the trip', async () => {
    const { transport, router, cache } = setup();
    const stops = makeStops(60);
    const day0 = new Date('2026-01-01T00:00:00Z');

    await buildTripSummary(stops, 'driving', { cache, router, now: day0 });
    expect(transport.calls).toHaveLength(3);

    // 29 days later: still fresh, no new requests.
    const day29 = new Date('2026-01-30T00:00:00Z');
    await buildTripSummary(stops, 'driving', { cache, router, now: day29 });
    expect(transport.calls).toHaveLength(3);

    // 31 days later: past the retention window, so everything refetches.
    const day31 = new Date('2026-02-01T00:00:00Z');
    const stale = await buildTripSummary(stops, 'driving', {
      cache,
      router,
      now: day31,
    });
    expect(transport.calls).toHaveLength(6);
    expect(stale.fetchedLegCount).toBe(59);
    expect(stale.estimatesFetchedAt).toEqual(day31);
  });

  it('computes the cutoff exactly 30 days back', () => {
    const now = new Date('2026-03-31T12:00:00Z');
    expect(cutoffFor(now).toISOString()).toBe('2026-03-01T12:00:00.000Z');
  });

  it('honours a custom TTL', () => {
    const now = new Date('2026-03-31T12:00:00Z');
    expect(cutoffFor(now, 7).toISOString()).toBe('2026-03-24T12:00:00.000Z');
  });
});

describe('totals and geometry', () => {
  it('reports totals that equal the sum of the per-leg figures', async () => {
    const { router, cache } = setup();
    const stops = makeStops(40);

    const summary = await buildTripSummary(stops, 'driving', { cache, router });

    const summedDistance = summary.legs.reduce((s, l) => s + l.distanceM, 0);
    const summedDuration = summary.legs.reduce((s, l) => s + l.durationS, 0);
    expect(summary.totalDistanceM).toBe(summedDistance);
    expect(summary.totalDurationS).toBe(summedDuration);
    expect(summary.totalNights).toBe(stops.reduce((s, x) => s + (x.days ?? 0), 0));
  });

  it('stitches one continuous polyline across chunk boundaries', async () => {
    const { router, cache } = setup();
    const stops = makeStops(60);

    const summary = await buildTripSummary(stops, 'driving', { cache, router });

    expect(summary.geometry.length).toBeGreaterThan(60);
    expect(summary.geometry[0][1]).toBeCloseTo(39, 5);
    expect(summary.geometry[summary.geometry.length - 1][1]).toBeCloseTo(39 + 59 * 0.1, 5);

    // No duplicated seam points anywhere in the stitched line.
    for (let i = 1; i < summary.geometry.length; i++) {
      const prev = summary.geometry[i - 1];
      const cur = summary.geometry[i];
      expect(prev[0] === cur[0] && prev[1] === cur[1]).toBe(false);
    }
  });

  it('handles a trip with fewer than two stops', async () => {
    const { transport, router, cache } = setup();
    const summary = await buildTripSummary(makeStops(1), 'driving', { cache, router });
    expect(transport.calls).toHaveLength(0);
    expect(summary.legs).toEqual([]);
    expect(summary.totalDistanceM).toBe(0);
    expect(summary.estimatesFetchedAt).toBeNull();
    expect(summary.geometry).toEqual([]);
  });

  it('routes a mixed driving/walking trip as separate single-profile requests', async () => {
    const { transport, router, cache } = setup();
    const stops = makeStops(6, { profileToNext: (i) => (i === 2 ? 'walking' : null) });

    const summary = await buildTripSummary(stops, 'driving', { cache, router });

    expect(transport.calls.map((c) => c.profile)).toEqual([
      'driving',
      'walking',
      'driving',
    ]);
    expect(summary.legs.map((l) => l.profile)).toEqual([
      'driving',
      'driving',
      'walking',
      'driving',
      'driving',
    ]);
  });
});

describe('unsupported profiles', () => {
  it('refuses rather than silently returning the wrong travel mode', async () => {
    // This guard exists because router.project-osrm.org accepts every profile
    // slug and returns car results for all of them. A provider that cannot
    // route walking must error, not hand back driving times labelled walking.
    const transport = makeFakeTransport();
    const drivingOnly: RouteDialect = {
      ...testDialect(24),
      name: 'driving-only',
      supportsProfile: (p) => p === 'driving',
    };
    const router = createChunkedRouter(drivingOnly, transport);
    const cache = createMemoryLegCache();
    const stops = makeStops(3, { profileToNext: () => 'walking' });

    await expect(buildTripSummary(stops, 'walking', { cache, router })).rejects.toThrow(
      /does not support the walking profile/,
    );
    expect(transport.calls).toHaveLength(0);
  });
});

describe('provider response validation', () => {
  const chunk = legKeysForStops(makeStops(4), 'driving');

  it('rejects a leg-count mismatch rather than misattributing distances', () => {
    expect(() =>
      mapChunkResponse(chunk, {
        code: 'Ok',
        routes: [{ distance: 1, duration: 1, legs: [{ distance: 1, duration: 1 }] }],
      }),
    ).toThrow(/returned 1 legs for 3 requested/);
  });

  it('surfaces a provider error code', () => {
    expect(() => mapChunkResponse(chunk, { code: 'NoRoute', message: 'no route' })).toThrow(
      /no route/,
    );
  });

  it('rejects an empty response', () => {
    expect(() => mapChunkResponse(chunk, { code: 'Ok', routes: [] })).toThrow(/no route/i);
  });
});
