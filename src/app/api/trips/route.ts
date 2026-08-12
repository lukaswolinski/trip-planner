import { apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor } from '@/lib/validation/schemas';
import { createTrip, listTrips } from '@/lib/trips/repository';

export async function GET(request: Request) {
  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  try {
    const rows = await listTrips(guarded.db, guarded.context);
    return apiOk({
      trips: rows,
      claimed: guarded.context.userId !== null,
      email: guarded.context.email,
    });
  } catch (error) {
    return serverError('GET /api/trips', error);
  }
}

export async function POST(request: Request) {
  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  const schemas = schemasFor(guarded.context.tier);
  const parsed = await parseJson(request, schemas.createTrip);
  if (!parsed.ok) return parsed.response;

  try {
    const trip = await createTrip(guarded.db, guarded.context, parsed.data);
    return apiOk({ trip }, 201);
  } catch (error) {
    return serverError('POST /api/trips', error);
  }
}
