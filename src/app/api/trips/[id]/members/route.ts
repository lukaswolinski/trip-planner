import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { guard } from '@/lib/guard';
import { schemasFor, uuidSchema } from '@/lib/validation/schemas';
import { getOwnedTrip } from '@/lib/trips/repository';
import { ensureOwnerMember, inviteMember, listMembers } from '@/lib/trips/members';
import { createMagicToken } from '@/lib/auth/magic-link';
import { sendMagicLink } from '@/lib/auth/mailer';

export async function GET(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/members'>,
) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    // The owner appears in the list so budget splits can include them.
    if (guarded.context.userId && guarded.context.email) {
      await ensureOwnerMember(
        guarded.db,
        id,
        guarded.context.userId,
        guarded.context.email,
      );
    }
    return apiOk({ members: await listMembers(guarded.db, id) });
  } catch (error) {
    return serverError('GET /api/trips/[id]/members', error);
  }
}

/**
 * Invites a trip mate.
 *
 * Requires an account, for two reasons. The invitation has to come *from*
 * somebody, and — more importantly — the invitee's access will bind to a user
 * id, which only exists once they sign in. An anonymous owner has no identity
 * to attach either side of that to.
 */
export async function POST(
  request: Request,
  ctx: RouteContext<'/api/trips/[id]/members'>,
) {
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return apiError('NOT_FOUND', 'Unknown trip');

  const guarded = await guard(request, 'writes');
  if (!guarded.ok) return guarded.response;

  const { userId, email: ownerEmail } = guarded.context;
  if (!userId || !ownerEmail) {
    return apiError(
      'EMAIL_REQUIRED',
      'Add your email before inviting others to this trip',
    );
  }

  const schemas = schemasFor(guarded.context.tier);
  const parsed = await parseJson(request, schemas.inviteMember);
  if (!parsed.ok) return parsed.response;

  try {
    const trip = await getOwnedTrip(guarded.db, id, guarded.context);
    if (!trip) return apiError('NOT_FOUND', 'Unknown trip');

    await ensureOwnerMember(guarded.db, id, userId, ownerEmail);

    const { member, created } = await inviteMember(
      guarded.db,
      id,
      parsed.data.email,
      userId,
    );

    /*
     * The invitation row is created BEFORE the email is attempted, and a send
     * failure does not roll it back.
     *
     * Delivery is the unreliable half: with no verified sending domain the
     * provider will refuse most addresses outright. The membership is still
     * real, and the invitee can accept by signing in with that address through
     * the normal sign-in box. So the honest response is "invited, but we could
     * not send the email" — reported to the UI as `emailSent: false` rather
     * than a silent success or a failure that loses the invitation.
     */
    let emailSent = false;
    let emailError: string | null = null;
    try {
      const { token } = await createMagicToken(
        guarded.db,
        parsed.data.email,
        guarded.context.sessionId,
      );
      const result = await sendMagicLink({
        to: parsed.data.email,
        token,
        tripId: id,
      });
      emailSent = result.delivered;
      if (!result.delivered) emailError = 'Email is not configured on this server.';
    } catch (error) {
      emailError =
        error instanceof Error ? error.message : 'The email could not be sent.';
    }

    return apiOk({ member, created, emailSent, emailError }, created ? 201 : 200);
  } catch (error) {
    return serverError('POST /api/trips/[id]/members', error);
  }
}
