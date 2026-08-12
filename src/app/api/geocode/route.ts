import { apiError, apiOk, parseQuery } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor } from '@/lib/validation/schemas';
import { createGeocoder } from '@/lib/routing/provider';
import { GeocodingNotConfiguredError } from '@/lib/geocoding/types';
import { RoutingNotConfiguredError } from '@/lib/routing/chunked-router';

/**
 * Forward-geocoding proxy for the stop search box.
 *
 * Any provider credential stays on the server, and only the four fields the UI
 * needs come back — proxying a provider's raw response would leak its internals
 * and bloat the payload.
 */
export async function GET(request: Request) {
  const guarded = await guard(request, 'geocode');
  if (!guarded.ok) return guarded.response;

  const schemas = schemasFor(guarded.context.tier);
  const parsed = parseQuery(new URL(request.url), schemas.geocodeQuery);
  if (!parsed.ok) return parsed.response;

  const { q, lat, lng } = parsed.data;

  try {
    const results = await createGeocoder().search(q, {
      limit: 5,
      // Bias results toward the map view when the client supplies a centre.
      proximity: lat !== undefined && lng !== undefined ? { lat, lng } : undefined,
    });
    return apiOk({ results });
  } catch (error) {
    console.error('[api] GET /api/geocode', error);
    if (
      error instanceof GeocodingNotConfiguredError ||
      error instanceof RoutingNotConfiguredError
    ) {
      return apiError(
        'UPSTREAM_ERROR',
        `Place search is not configured on this server: ${error.variable} is missing.`,
        { configuration: error.variable },
      );
    }
    return apiError('UPSTREAM_ERROR', 'Place search is unavailable right now');
  }
}
