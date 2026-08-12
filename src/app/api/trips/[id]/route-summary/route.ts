import { apiError, apiOk, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip, listStops } from '@/lib/trips/repository';
import { estimateAgeDays, summarizeTrip } from '@/lib/routing/service';
import {
  RoutingNotConfiguredError,
  RoutingProviderError,
  RoutingUnreachableError,
} from '@/lib/routing/chunked-router';

/**
 * Recomputes legs and totals for a trip.
 *
 * POST rather than GET because it can cause provider calls and cache writes —
 * it is not a safe, cacheable read.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/route-summary'>,
) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'routeSummary');
  if (!guarded.ok) return guarded.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    const tripStops = await listStops(guarded.db, id);
    const now = new Date();
    const summary = await summarizeTrip(guarded.db, trip, tripStops, now);

    return apiOk({
      ...summary,
      estimateAgeDays: estimateAgeDays(summary.estimatesFetchedAt, now),
    });
  } catch (error) {
    if (error instanceof RoutingNotConfiguredError) {
      // A setup problem, not a server fault. Name what is missing.
      console.error('[api] route-summary: provider not configured', error.variable);
      return apiError(
        'UPSTREAM_ERROR',
        `Routing is not configured on this server: ${error.variable} is missing.`,
        { configuration: error.variable },
      );
    }
    if (error instanceof RoutingUnreachableError) {
      // Upstream is down, not our fault and not the user's data. The demo
      // servers give no uptime guarantee, so say so plainly and keep the trip
      // usable — the cached legs still render.
      console.error('[api] route-summary: provider unreachable', error.provider);
      return apiError(
        'UPSTREAM_ERROR',
        'The routing service is not responding right now. Your trip is saved — try recalculating in a moment.',
        { provider: error.provider },
      );
    }
    if (error instanceof RoutingProviderError) {
      // An unroutable leg (walking across an ocean) is the user's data being
      // unroutable, not a bug — say so plainly.
      return apiError('UPSTREAM_ERROR', `Could not route this trip: ${error.message}`, {
        providerCode: error.code,
      });
    }
    return serverError('POST /api/trips/[id]/route-summary', error);
  }
}
