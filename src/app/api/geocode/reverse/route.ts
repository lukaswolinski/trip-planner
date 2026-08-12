import { z } from 'zod';
import { apiError, apiOk, parseQuery } from '@/lib/api';
import { guard } from '@/lib/guard';
import { createGeocoder } from '@/lib/routing/provider';
import { GeocodingNotConfiguredError } from '@/lib/geocoding/types';
import { RoutingNotConfiguredError } from '@/lib/routing/chunked-router';

const querySchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

/**
 * Names a coordinate, so a pasted point can be labelled with a real place rather
 * than its numbers.
 *
 * Shares the `geocode` rate-limit bucket: it is the same upstream service and the
 * same courtesy limit. A failure here is non-fatal by design — the caller falls
 * back to showing the coordinates, so this returns `{ result: null }` rather than
 * an error when the lookup simply finds nothing.
 */
export async function GET(request: Request) {
  const guarded = await guard(request, 'geocode');
  if (!guarded.ok) return guarded.response;

  const parsed = parseQuery(new URL(request.url), querySchema);
  if (!parsed.ok) return parsed.response;

  const geocoder = createGeocoder();
  if (!geocoder.reverse) {
    // Provider has no reverse support; the client shows the coordinates.
    return apiOk({ result: null, supported: false });
  }

  try {
    const result = await geocoder.reverse(parsed.data.lat, parsed.data.lng);
    return apiOk({ result, supported: true });
  } catch (error) {
    console.error('[api] GET /api/geocode/reverse', error);
    if (
      error instanceof GeocodingNotConfiguredError ||
      error instanceof RoutingNotConfiguredError
    ) {
      return apiError(
        'UPSTREAM_ERROR',
        `Reverse geocoding is not configured: ${error.variable} is missing.`,
        { configuration: error.variable },
      );
    }
    return apiError('UPSTREAM_ERROR', 'Could not look up a name for that point');
  }
}
