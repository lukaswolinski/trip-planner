/**
 * Provider selection and retention policy — pure env reads, no credentials and
 * no network, so it is directly testable.
 *
 * Routing and geocoding are chosen independently because they are genuinely
 * independent decisions: you might route with self-hosted OSRM while geocoding
 * with Photon, or route with Mapbox while keeping Photon for search.
 */

export const ROUTING_PROVIDERS = ['osrm', 'mapbox'] as const;
export type RoutingProviderName = (typeof ROUTING_PROVIDERS)[number];

export const GEOCODING_PROVIDERS = ['photon', 'mapbox'] as const;
export type GeocodingProviderName = (typeof GEOCODING_PROVIDERS)[number];

/** Explicit env var wins; otherwise the provider that needs no account. */
export function routingProviderName(): RoutingProviderName {
  const configured = process.env.ROUTING_PROVIDER?.trim().toLowerCase();
  if (configured === 'mapbox' || configured === 'osrm') return configured;
  return 'osrm';
}

export function geocodingProviderName(): GeocodingProviderName {
  const configured = process.env.GEOCODING_PROVIDER?.trim().toLowerCase();
  if (configured === 'mapbox' || configured === 'photon') return configured;
  return 'photon';
}

/** Mapbox's Product Terms cap retention of routing results at 30 days. */
export const MAPBOX_MAX_CACHE_TTL_DAYS = 30;

/**
 * How long routing results may be retained.
 *
 * Under Mapbox this is contractual, so the value is clamped and an env var
 * cannot breach the terms. Under OSRM/OSM there is no equivalent restriction —
 * ODbL does not cap retention — so the TTL is purely a freshness choice and can
 * be tuned freely.
 */
export function cacheTtlDays(defaultTtl: number): number {
  const raw = process.env.CACHE_TTL_DAYS;
  const configured = raw ? Number(raw) : Number.NaN;
  const requested =
    Number.isInteger(configured) && configured > 0 ? configured : defaultTtl;

  if (routingProviderName() === 'mapbox') {
    return Math.min(requested, MAPBOX_MAX_CACHE_TTL_DAYS);
  }
  return requested;
}
