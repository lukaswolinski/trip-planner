/**
 * Mapbox dialect — retained so an account with billing set up can be used by
 * changing one env var. Pure: no credentials, no network. Transport lives in
 * mapbox-transport.ts.
 *
 * Mapbox caps a Directions request at 25 coordinates (24 legs), and its Product
 * Terms cap caching of routing results at 30 days. Both are provider-specific,
 * which is why they live here rather than in the shared core.
 */

import { MAX_LEGS_PER_REQUEST, type TravelProfile } from '@/lib/limits';
import type { RouteDialect } from '../chunked-router';
import { runProfile, runToCoordinates, type LegKey } from '../legs';

export const MAPBOX_DIRECTIONS_BASE = 'https://api.mapbox.com/directions/v5/';

/**
 * We deliberately use `driving`, not `driving-traffic`: traffic-aware durations
 * describe conditions right now, which is meaningless for a trip weeks out, and
 * `driving-traffic` also collapses the Matrix coordinate cap from 25 to 10,
 * which would hurt Phase 2 route optimization.
 */
export const MAPBOX_PROFILE: Record<TravelProfile, string> = {
  driving: 'mapbox/driving',
  walking: 'mapbox/walking',
};

export function createMapboxDialect(
  maxLegsPerRequest: number = MAX_LEGS_PER_REQUEST,
): RouteDialect {
  return {
    name: 'mapbox',
    maxLegsPerRequest,
    supportsProfile: (profile) => profile in MAPBOX_PROFILE,
    buildPath(chunk: readonly LegKey[]): string {
      const profile = MAPBOX_PROFILE[runProfile(chunk)];
      const coords = runToCoordinates(chunk)
        .map((c) => `${c.lng},${c.lat}`)
        .join(';');

      // See osrm.ts for why steps=true is load-bearing rather than decorative.
      const query = new URLSearchParams({
        geometries: 'polyline6',
        overview: 'full',
        steps: 'true',
        continue_straight: 'false',
      });

      return `${profile}/${coords}?${query.toString()}`;
    },
  };
}
