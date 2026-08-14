import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip } from '@/lib/trips/repository';
import {
  addItineraryItem,
  listItinerary,
  stopBelongsToTrip,
} from '@/lib/trips/itinerary';

/**
 * Both handlers resolve ownership the same way, and it is the only thing
 * standing between a guessed id and someone else's data:
 *
 *   trip is owned by this session/user  ->  stop belongs to that trip  ->  act
 *
 * There is deliberately no query anywhere that finds an itinerary item by its
 * id alone.
 */
async function resolve(
  request: Request,
  tripId: string,
  stopId: string,
) {
  if (!uuidSchema.safeParse(tripId).success) return { ok: false as const, why: 'trip' };
  if (!uuidSchema.safeParse(stopId).success) return { ok: false as const, why: 'stop' };

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return { ok: false as const, response: guarded.response };

  const trip = await getOwnedTrip(guarded.db, tripId, guarded.context);
  if (!trip) return { ok: false as const, why: 'trip' };

  if (!(await stopBelongsToTrip(guarded.db, tripId, stopId))) {
    return { ok: false as const, why: 'stop' };
  }
  return { ok: true as const, guarded };
}

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/stops/[stopId]/itinerary'>,
) {
  const { id, stopId } = await ctx.params;
  const resolved = await resolve(request, id, stopId);
  if (!resolved.ok) {
    return resolved.response ?? apiError('NOT_FOUND', 'Unknown stop');
  }

  try {
    return apiOk({ items: await listItinerary(resolved.guarded.db, stopId) });
  } catch (error) {
    return serverError('GET /api/trips/[id]/stops/[stopId]/itinerary', error);
  }
}

export async function POST(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/stops/[stopId]/itinerary'>,
) {
  const { id, stopId } = await ctx.params;
  const resolved = await resolve(request, id, stopId);
  if (!resolved.ok) {
    return resolved.response ?? apiError('NOT_FOUND', 'Unknown stop');
  }

  const schemas = schemasFor(resolved.guarded.context.tier);
  const parsed = await parseJson(request, schemas.createItineraryItem);
  if (!parsed.ok) return parsed.response;

  try {
    const item = await addItineraryItem(resolved.guarded.db, stopId, parsed.data);
    return apiOk({ item }, 201);
  } catch (error) {
    return serverError('POST /api/trips/[id]/stops/[stopId]/itinerary', error);
  }
}
