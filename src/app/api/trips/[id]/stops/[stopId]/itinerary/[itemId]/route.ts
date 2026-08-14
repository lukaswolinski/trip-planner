import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip } from '@/lib/trips/repository';
import {
  deleteItineraryItem,
  patchItineraryItem,
  stopBelongsToTrip,
} from '@/lib/trips/itinerary';

/** Same ownership chain as the collection route; see the note there. */
async function resolve(request: Request, tripId: string, stopId: string) {
  if (!uuidSchema.safeParse(tripId).success) return { ok: false as const };
  if (!uuidSchema.safeParse(stopId).success) return { ok: false as const };

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return { ok: false as const, response: guarded.response };

  const trip = await getOwnedTrip(guarded.db, tripId, guarded.context);
  if (!trip) return { ok: false as const };
  if (!(await stopBelongsToTrip(guarded.db, tripId, stopId))) {
    return { ok: false as const };
  }
  return { ok: true as const, guarded };
}

export async function PATCH(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/stops/[stopId]/itinerary/[itemId]'>,
) {
  const { id, stopId, itemId } = await ctx.params;
  if (!uuidSchema.safeParse(itemId).success) {
    return apiError('NOT_FOUND', 'Unknown itinerary item');
  }

  const resolved = await resolve(request, id, stopId);
  if (!resolved.ok) return resolved.response ?? apiError('NOT_FOUND', 'Unknown stop');

  const schemas = schemasFor(resolved.guarded.context.tier);
  const parsed = await parseJson(request, schemas.patchItineraryItem);
  if (!parsed.ok) return parsed.response;

  try {
    const item = await patchItineraryItem(
      resolved.guarded.db,
      stopId,
      itemId,
      parsed.data,
    );
    if (!item) return apiError('NOT_FOUND', 'Unknown itinerary item');
    return apiOk({ item });
  } catch (error) {
    return serverError('PATCH itinerary item', error);
  }
}

export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/stops/[stopId]/itinerary/[itemId]'>,
) {
  const { id, stopId, itemId } = await ctx.params;
  if (!uuidSchema.safeParse(itemId).success) {
    return apiError('NOT_FOUND', 'Unknown itinerary item');
  }

  const resolved = await resolve(request, id, stopId);
  if (!resolved.ok) return resolved.response ?? apiError('NOT_FOUND', 'Unknown stop');

  try {
    const removed = await deleteItineraryItem(resolved.guarded.db, stopId, itemId);
    if (!removed) return apiError('NOT_FOUND', 'Unknown itinerary item');
    return apiOk({ deleted: true });
  } catch (error) {
    return serverError('DELETE itinerary item', error);
  }
}
