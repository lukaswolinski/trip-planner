/**
 * Provider-specific URL shapes and selection.
 *
 * The OSRM expectations here encode facts that were verified against the live
 * demo servers, not assumptions — see the table in
 * lib/routing/providers/osrm.ts.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createOsrmDialect,
  osrmBaseUrl,
  osrmMaxLegsPerRequest,
} from '@/lib/routing/providers/osrm';
import { createMapboxDialect } from '@/lib/routing/providers/mapbox';
import {
  cacheTtlDays,
  geocodingProviderName,
  routingProviderName,
} from '@/lib/routing/provider-config';
import { legKeysForStops } from '@/lib/routing/legs';
import { makeStops } from './helpers';

function pathFor(dialect: ReturnType<typeof createOsrmDialect>, stops = 3, profile: 'driving' | 'walking' = 'driving') {
  const keys = legKeysForStops(
    makeStops(stops, { profileToNext: () => profile }),
    profile,
  );
  return dialect.buildPath(keys);
}

describe('OSRM dialect', () => {
  const dialect = createOsrmDialect(99);

  it('routes driving via the routed-car instance', () => {
    const path = pathFor(dialect, 3, 'driving');
    expect(path.startsWith('routed-car/route/v1/driving/')).toBe(true);
  });

  it('routes walking via the routed-foot instance', () => {
    // router.project-osrm.org ignores the profile slug and returns car results
    // for every one of them, so the foot profile must come from a separate
    // instance rather than a different slug on the same one.
    const path = pathFor(dialect, 3, 'walking');
    expect(path.startsWith('routed-foot/route/v1/foot/')).toBe(true);
  });

  it('emits lng,lat pairs separated by semicolons', () => {
    const path = pathFor(dialect, 3);
    const coords = path.split('?')[0].split('/').at(-1)!;
    const pairs = coords.split(';');
    expect(pairs).toHaveLength(3);
    for (const pair of pairs) {
      const [lng, lat] = pair.split(',').map(Number);
      // Our fixture stops sit in the western United States.
      expect(lng).toBeLessThan(0);
      expect(lat).toBeGreaterThan(0);
    }
  });

  it('requests polyline6 geometry with per-leg steps', () => {
    const query = new URLSearchParams(pathFor(dialect).split('?')[1]);
    expect(query.get('geometries')).toBe('polyline6');
    expect(query.get('steps')).toBe('true');
    expect(query.get('overview')).toBe('full');
    expect(query.get('continue_straight')).toBe('false');
  });

  it('supports both travel profiles', () => {
    expect(dialect.supportsProfile('driving')).toBe(true);
    expect(dialect.supportsProfile('walking')).toBe(true);
  });

  it('defaults to a ceiling well above Mapbox and below the verified 120', () => {
    const max = osrmMaxLegsPerRequest();
    expect(max).toBeGreaterThan(24);
    expect(max).toBeLessThan(120);
  });

  it('defaults to the profile-aware demo host', () => {
    expect(osrmBaseUrl()).toBe('https://routing.openstreetmap.de');
  });
});

describe('Mapbox dialect', () => {
  const dialect = createMapboxDialect(24);

  it('prefixes the profile with the mapbox owner', () => {
    expect(pathFor(dialect, 3, 'driving').startsWith('mapbox/driving/')).toBe(true);
    expect(pathFor(dialect, 3, 'walking').startsWith('mapbox/walking/')).toBe(true);
  });

  it('caps at 24 legs per request', () => {
    expect(dialect.maxLegsPerRequest).toBe(24);
  });

  it('requests the same geometry options as OSRM', () => {
    const query = new URLSearchParams(pathFor(dialect).split('?')[1]);
    expect(query.get('geometries')).toBe('polyline6');
    expect(query.get('steps')).toBe('true');
  });
});

describe('provider selection', () => {
  beforeEach(() => {
    delete process.env.ROUTING_PROVIDER;
    delete process.env.GEOCODING_PROVIDER;
    delete process.env.CACHE_TTL_DAYS;
  });

  it('defaults to the providers that need no account', () => {
    expect(routingProviderName()).toBe('osrm');
    expect(geocodingProviderName()).toBe('photon');
  });

  it('honours an explicit choice', () => {
    process.env.ROUTING_PROVIDER = 'mapbox';
    process.env.GEOCODING_PROVIDER = 'mapbox';
    expect(routingProviderName()).toBe('mapbox');
    expect(geocodingProviderName()).toBe('mapbox');
  });

  it('ignores an unrecognised value rather than failing at request time', () => {
    process.env.ROUTING_PROVIDER = 'graphhopper';
    expect(routingProviderName()).toBe('osrm');
  });

  it('is case and whitespace tolerant', () => {
    process.env.ROUTING_PROVIDER = '  MAPBOX ';
    expect(routingProviderName()).toBe('mapbox');
  });
});

describe('cache TTL by provider', () => {
  beforeEach(() => {
    delete process.env.ROUTING_PROVIDER;
    delete process.env.CACHE_TTL_DAYS;
  });

  it('clamps to 30 days under Mapbox, whatever the env var says', () => {
    // Mapbox's Product Terms cap retention of routing results at 30 days, so an
    // env var must not be able to breach the terms.
    process.env.ROUTING_PROVIDER = 'mapbox';
    process.env.CACHE_TTL_DAYS = '365';
    expect(cacheTtlDays(30)).toBe(30);
  });

  it('allows a shorter TTL under Mapbox', () => {
    process.env.ROUTING_PROVIDER = 'mapbox';
    process.env.CACHE_TTL_DAYS = '7';
    expect(cacheTtlDays(30)).toBe(7);
  });

  it('allows a longer TTL under OSRM, where ODbL sets no retention cap', () => {
    process.env.ROUTING_PROVIDER = 'osrm';
    process.env.CACHE_TTL_DAYS = '365';
    expect(cacheTtlDays(30)).toBe(365);
  });

  it('falls back to the default for missing or nonsense values', () => {
    expect(cacheTtlDays(30)).toBe(30);
    process.env.CACHE_TTL_DAYS = 'soon';
    expect(cacheTtlDays(30)).toBe(30);
    process.env.CACHE_TTL_DAYS = '-5';
    expect(cacheTtlDays(30)).toBe(30);
  });
});
