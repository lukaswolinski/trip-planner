import { apiError, apiOk, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip } from '@/lib/trips/repository';
import { removeMember } from '@/lib/trips/members';

/**
 * Removes a trip mate.
 *
 * Access is the membership row, so deleting it ends access on the very next
 * request — there is no token to revoke and nothing cached to expire.
 */
export async function DELETE(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/members/[memberId]'>,
) {
  const { id, memberId } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');
  if (!uuidSchema.safeParse(memberId).success) {
    return apiError('NOT_FOUND', 'Unknown member');
  }

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    const removed = await removeMember(guarded.db, id, memberId);
    if (!removed) return apiError('NOT_FOUND', 'Unknown member');
    return apiOk({ deleted: true });
  } catch (error) {
    return serverError('DELETE /api/trips/[id]/members/[memberId]', error);
  }
}
