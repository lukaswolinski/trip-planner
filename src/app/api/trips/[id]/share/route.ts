import { apiError, apiOk, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip, newShareSlug, setShareSlug } from '@/lib/trips/repository';
import { appUrl } from '@/lib/app-url';

type Ctx = RouteContext<'/api/trips/[id]/share'>;

/**
 * Minting a share link requires a claimed account.
 *
 * The gate is here, on the server, rather than only in the UI: an anonymous
 * cookie session is disposable, and a link that outlives its creator's cookie
 * would be an orphan nobody could revoke.
 */
export async function POST(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  if (!guarded.context.userId) {
    return apiError(
      'EMAIL_REQUIRED',
      'Add your email to create a shareable link and keep your trips',
    );
  }

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    // Reuse an existing slug so re-opening the dialog does not invalidate a
    // link someone has already sent to friends.
    const slug = trip.shareSlug ?? newShareSlug();
    const updated = await setShareSlug(guarded.db, id, guarded.context, slug);
    if (!updated) return apiError('NOT_FOUND', 'Unknown trip');

    return apiOk({
      shareSlug: slug,
      shareUrl: `${appUrl()}/t/${slug}`,
      sharedAt: updated.sharedAt,
    });
  } catch (error) {
    return serverError('POST /api/trips/[id]/share', error);
  }
}

/** Revokes the link. The next visitor to the old URL gets a 404. */
export async function DELETE(request: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  try {
    const updated = await setShareSlug(guarded.db, id, guarded.context, null);
    if (!updated) return apiError('NOT_FOUND', 'Unknown trip');
    return apiOk({ revoked: true });
  } catch (error) {
    return serverError('DELETE /api/trips/[id]/share', error);
  }
}
