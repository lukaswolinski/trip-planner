import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip } from '@/lib/trips/repository';
import {
  listItinerary,
  reorderItinerary,
  stopBelongsToTrip,
} from '@/lib/trips/itinerary';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/stops/[stopId]/itinerary/reorder'>,
) {
  const { id, stopId } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');
  if (!uuidSchema.safeParse(stopId).success) return apiError('NOT_FOUND', 'Unknown stop');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  const schemas = schemasFor(guarded.context.tier);
  const parsed = await parseJson(request, schemas.reorderItinerary);
  if (!parsed.ok) return parsed.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');
    if (!(await stopBelongsToTrip(guarded.db, id, stopId))) {
      return apiError('NOT_FOUND', 'Unknown stop');
    }

    // Rejected wholesale rather than partially applied when the ids are not a
    // permutation of this stop's items — that check is what stops an id from
    // another stop being written in.
    const ok = await reorderItinerary(guarded.db, stopId, parsed.data.orderedIds);
    if (!ok) {
      return apiError('BAD_REQUEST', 'Order does not match this stop’s items');
    }

    return apiOk({ items: await listItinerary(guarded.db, stopId) });
  } catch (error) {
    return serverError('POST itinerary reorder', error);
  }
}
