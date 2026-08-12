/**
 * OSRM dialect — the keyless default. Pure: no credentials, no network, so the
 * URL shape is directly testable. The HTTP transport lives in osrm-transport.ts.
 *
 * ## Why routing.openstreetmap.de and not router.project-osrm.org
 *
 * Verified against the live services, not assumed: `router.project-osrm.org`
 * **ignores the profile slug**. Requesting `/route/v1/driving`, `/foot`, `/bike`,
 * `/walking`, `/car` and `/cycling` for the same three coordinates all returned
 * byte-identical results (110487 m / 4846 s) — it serves the car profile and the
 * slug is decorative. Using it for walking would silently return driving times
 * labelled as walking, which is worse than an error.
 *
 * `routing.openstreetmap.de` runs a separate osrm-routed per profile behind path
 * prefixes and genuinely honours them. Same coordinates:
 *
 * | endpoint                          | distance | duration |
 * | --------------------------------- | -------- | -------- |
 * | `/routed-car/route/v1/driving/…`  | 110487 m |  4846 s  |
 * | `/routed-foot/route/v1/foot/…`    | 124165 m | 99517 s  |
 * | `/routed-bike/route/v1/bike/…`    | 128229 m | 23450 s  |
 *
 * ## Usage terms
 *
 * The demo servers are for reasonable, non-commercial use at no more than
 * ~1 request/second, with no uptime guarantee, and access may be withdrawn at
 * any time. Fine for development and personal use; self-host osrm-backend before
 * putting this in front of real users. OSM attribution is required.
 */

import type { TravelProfile } from '@/lib/limits';
import type { RouteDialect } from '../chunked-router';
import { runProfile, runToCoordinates, type LegKey } from '../legs';

export const OSRM_DEFAULT_BASE_URL = 'https://routing.openstreetmap.de';

/** Path prefix and profile slug per travel mode, as verified above. */
export const OSRM_ROUTE: Record<TravelProfile, { prefix: string; slug: string }> = {
  driving: { prefix: 'routed-car', slug: 'driving' },
  walking: { prefix: 'routed-foot', slug: 'foot' },
};

/**
 * The demo server accepted 120 coordinates (119 legs) in testing, far beyond
 * Mapbox's 25. We default to 99 legs to leave headroom below an undocumented
 * ceiling, which also means *fewer* requests — worth having when the courtesy
 * limit is one request per second. A 250-stop trip becomes 3 requests, not 11.
 */
export const OSRM_DEFAULT_MAX_LEGS = 99;

export function osrmMaxLegsPerRequest(): number {
  const raw = process.env.OSRM_MAX_LEGS_PER_REQUEST;
  if (!raw) return OSRM_DEFAULT_MAX_LEGS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return OSRM_DEFAULT_MAX_LEGS;
  return parsed;
}

export function osrmBaseUrl(): string {
  return (process.env.OSRM_BASE_URL ?? OSRM_DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/**
 * A descriptive User-Agent is required by OSM-hosted services; a stock HTTP
 * library default is explicitly not acceptable.
 */
export function osmUserAgent(): string {
  const contact = process.env.OSM_CONTACT?.trim();
  const app = process.env.OSM_APP_NAME?.trim() || 'trip-planner';
  return contact ? `${app} (+${contact})` : app;
}

export function createOsrmDialect(
  maxLegsPerRequest: number = osrmMaxLegsPerRequest(),
): RouteDialect {
  return {
    name: 'osrm',
    maxLegsPerRequest,
    supportsProfile: (profile) => profile in OSRM_ROUTE,
    buildPath(chunk: readonly LegKey[]): string {
      const profile = runProfile(chunk);
      const route = OSRM_ROUTE[profile];
      if (!route) {
        throw new Error(`OSRM provider has no endpoint for profile ${profile}`);
      }

      const coords = runToCoordinates(chunk)
        .map((c) => `${c.lng},${c.lat}`)
        .join(';');

      // `steps=true` is required, not decorative: OSRM returns geometry at the
      // route level, and the only per-leg geometry available is the
      // concatenation of that leg's steps. Without it, legs could not be cached
      // independently — and independent legs are the whole design.
      const query = new URLSearchParams({
        geometries: 'polyline6',
        overview: 'full',
        steps: 'true',
        continue_straight: 'false',
      });

      return `${route.prefix}/route/v1/${route.slug}/${coords}?${query.toString()}`;
    },
  };
}
