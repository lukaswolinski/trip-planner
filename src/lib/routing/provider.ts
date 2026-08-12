/**
 * Builds the configured router and geocoder. Server-only, because it pulls in
 * the transports that hold credentials.
 *
 * The selection logic itself is pure and lives in provider-config.ts.
 */
import 'server-only';

import { createChunkedRouter, type Router } from './chunked-router';
import { createOsrmDialect } from './providers/osrm';
import { osrmTransport } from './providers/osrm-transport';
import { createMapboxDialect } from './providers/mapbox';
import { mapboxTransport } from './providers/mapbox-transport';
import { createPhotonGeocoder } from '@/lib/geocoding/photon';
import { createMapboxGeocoder } from '@/lib/geocoding/mapbox';
import type { Geocoder } from '@/lib/geocoding/types';
import { geocodingProviderName, routingProviderName } from './provider-config';

export function createRouter(): Router {
  switch (routingProviderName()) {
    case 'mapbox':
      return createChunkedRouter(createMapboxDialect(), mapboxTransport);
    case 'osrm':
    default:
      return createChunkedRouter(createOsrmDialect(), osrmTransport);
  }
}

export function createGeocoder(): Geocoder {
  switch (geocodingProviderName()) {
    case 'mapbox':
      return createMapboxGeocoder();
    case 'photon':
    default:
      return createPhotonGeocoder();
  }
}

export {
  cacheTtlDays,
  geocodingProviderName,
  routingProviderName,
  type GeocodingProviderName,
  type RoutingProviderName,
} from './provider-config';
