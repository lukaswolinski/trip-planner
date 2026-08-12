import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { addStop, countStops, getOwnedTrip } from '@/lib/trips/repository';

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/stops'>,
) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  const schemas = schemasFor(guarded.context.tier);
  const parsed = await parseJson(request, schemas.createStop);
  if (!parsed.ok) return parsed.response;

  try {
    // Ownership is checked before any write, and the write itself is scoped to
    // this trip id.
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    const { limits } = guarded.context;
    const result = await addStop(guarded.db, id, parsed.data, limits.hardMaxStops);

    if (result.status === 'too_many') {
      return apiError(
        'TOO_MANY_STOPS',
        `A trip can hold at most ${result.limit} stops`,
        { limit: result.limit },
      );
    }

    const total = await countStops(guarded.db, id);
    return apiOk(
      {
        stop: result.stop,
        stopCount: total,
        // Soft cap: the request succeeded, but the UI should start warning.
        overSoftCap: total > limits.maxStops,
        softCap: limits.maxStops,
      },
      201,
    );
  } catch (error) {
    return serverError('POST /api/trips/[id]/stops', error);
  }
}
