import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { deleteStop, getOwnedTrip, patchStop } from '@/lib/trips/repository';

type Ctx = RouteContext<'/api/trips/[id]/stops/[stopId]'>;

export async function PATCH(request: Request, ctx: Ctx) {
  const { id, stopId } = await ctx.params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(stopId).success) {
    return apiError('NOT_FOUND', 'Unknown stop');
  }

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  const schemas = schemasFor(guarded.context.tier);
  const parsed = await parseJson(request, schemas.patchStop);
  if (!parsed.ok) return parsed.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    // Scoped by trip id as well as stop id, so a stop belonging to another
    // trip cannot be edited even if its id is known.
    const stop = await patchStop(guarded.db, id, stopId, parsed.data);
    if (!stop) return apiError('NOT_FOUND', 'Unknown stop');

    return apiOk({ stop });
  } catch (error) {
    return serverError('PATCH /api/trips/[id]/stops/[stopId]', error);
  }
}

export async function DELETE(request: Request, ctx: Ctx) {
  const { id, stopId } = await ctx.params;
  if (!uuidSchema.safeParse(id).success || !uuidSchema.safeParse(stopId).success) {
    return apiError('NOT_FOUND', 'Unknown stop');
  }

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    const removed = await deleteStop(guarded.db, id, stopId);
    if (!removed) return apiError('NOT_FOUND', 'Unknown stop');

    return apiOk({ deleted: true });
  } catch (error) {
    return serverError('DELETE /api/trips/[id]/stops/[stopId]', error);
  }
}
