/**
 * Mapbox Geocoding v6 — retained behind the provider interface.
 *
 * `permanent=true` is mandatory here, not an optimisation: we persist the
 * returned coordinates in `stops`, and Mapbox's *temporary* geocoding terms
 * forbid storing coordinates at all. The account must have permanent geocoding
 * enabled. Photon has no equivalent restriction.
 */
import 'server-only';

import { mapboxSecretToken } from '@/lib/routing/providers/mapbox-transport';
import { classifyFeature, rankResults } from './rank';
import type { GeocodeOptions, GeocodeResult, Geocoder } from './types';

const GEOCODE_FORWARD = 'https://api.mapbox.com/search/geocode/v6/forward';
const GEOCODE_REVERSE = 'https://api.mapbox.com/search/geocode/v6/reverse';

export function createMapboxGeocoder(): Geocoder {
  return {
    name: 'mapbox',
    async search(query, options: GeocodeOptions = {}) {
      const params = new URLSearchParams({
        q: query,
        permanent: 'true',
        autocomplete: 'true',
        limit: String(options.limit ?? 5),
        access_token: mapboxSecretToken(),
      });
      if (options.proximity) {
        params.set('proximity', `${options.proximity.lng},${options.proximity.lat}`);
      }

      const response = await fetch(`${GEOCODE_FORWARD}?${params.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(
          `Mapbox Geocoding responded ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as {
        features?: Array<{
          properties?: {
            name?: string;
            name_preferred?: string;
            full_address?: string;
            place_formatted?: string;
            coordinates?: { longitude?: number; latitude?: number };
          };
        }>;
      };

      return toResults(data);
    },

    async reverse(lat, lng) {
      // permanent=true for the same reason as forward geocoding: we store the
      // result alongside the stop.
      const params = new URLSearchParams({
        longitude: String(lng),
        latitude: String(lat),
        limit: '1',
        permanent: 'true',
        access_token: mapboxSecretToken(),
      });

      const response = await fetch(`${GEOCODE_REVERSE}?${params.toString()}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        throw new Error(`Mapbox reverse geocoding responded ${response.status}`);
      }

      const [first] = toResults((await response.json()) as MapboxGeocodeResponse);
      return first ?? null;
    },
  };
}

interface MapboxGeocodeResponse {
  features?: Array<{
    properties?: {
      name?: string;
      name_preferred?: string;
      full_address?: string;
      place_formatted?: string;
      /** place | locality | district | region | country | postcode | address | street | poi */
      feature_type?: string;
      coordinates?: { longitude?: number; latitude?: number };
    };
  }>;
}

function toResults(data: MapboxGeocodeResponse): GeocodeResult[] {
  const results: GeocodeResult[] = [];
  for (const feature of data.features ?? []) {
    const p = feature.properties;
    const lng = p?.coordinates?.longitude;
    const lat = p?.coordinates?.latitude;
    if (typeof lng !== 'number' || typeof lat !== 'number') continue;
    // Mapbox has no osm_key/osm_value; its feature_type maps onto the same tiers.
    const { tier, label, placeRank } = classifyFeature({ type: p?.feature_type });
    results.push({
      name: p?.name_preferred ?? p?.name ?? 'Unnamed place',
      address: p?.full_address ?? p?.place_formatted ?? null,
      lng,
      lat,
      kind: label,
      tier,
      placeRank,
    });
  }
  return rankResults(results);
}
