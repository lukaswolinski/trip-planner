import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip, listStops, reorderStops } from '@/lib/trips/repository';

/**
 * Takes the complete new ordering. Sending the whole array rather than a
 * from/to pair means the server never has to infer intent from an index, and a
 * dropped request cannot leave the list half-reordered.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/reorder'>,
) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  const schemas = schemasFor(guarded.context.tier);
  const parsed = await parseJson(request, schemas.reorder);
  if (!parsed.ok) return parsed.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    const result = await reorderStops(guarded.db, id, parsed.data.stopIds);
    if (result.status === 'mismatch') {
      return apiError('BAD_REQUEST', result.message);
    }

    return apiOk({ stops: await listStops(guarded.db, id) });
  } catch (error) {
    return serverError('POST /api/trips/[id]/reorder', error);
  }
}
