import { apiError, apiOk, parseJson, serverError } from '@/lib/api';
import { getSessionContext } from '@/lib/auth/session';
import { createMagicToken } from '@/lib/auth/magic-link';
import { MailNotConfiguredError, sendMagicLink } from '@/lib/auth/mailer';
import { getDb } from '@/lib/db';
import { emailRateKey, ipRateKey } from '@/lib/ip';
import { checkRateLimits, rateLimitResponse, type BucketCheck } from '@/lib/rate-limit';
import { getLimits } from '@/lib/limits';
import { schemasFor } from '@/lib/validation/schemas';

/**
 * Requests a sign-in link.
 *
 * Limited per IP *and* per email address: the IP bucket stops one network
 * blasting many addresses, the email bucket stops one address being mail-bombed
 * from many networks.
 */
export async function POST(request: Request) {
  let db;
  let context;
  try {
    db = getDb();
    context = await getSessionContext();
  } catch (error) {
    return serverError('POST /api/auth/request', error);
  }

  const schemas = schemasFor(context.tier);
  const parsed = await parseJson(request, schemas.authRequest);
  if (!parsed.ok) return parsed.response;

  const { email, tripId } = parsed.data;
  const rules = getLimits(context.tier).rate.authRequest;

  const checks: BucketCheck[] = [
    { key: emailRateKey('auth', email), rule: rules.email, scope: 'email' },
  ];
  const ipKey = ipRateKey('auth', request.headers);
  if (ipKey) checks.push({ key: ipKey, rule: rules.ip, scope: 'ip' });

  try {
    const decision = await checkRateLimits(db, checks);
    if (!decision.allowed) return rateLimitResponse(decision);

    const { token } = await createMagicToken(db, email, context.sessionId);
    const result = await sendMagicLink({ to: email, token, tripId });

    if (!result.delivered) {
      // Report the truth: nothing was sent. The UI shows setup instructions
      // rather than telling the user to check an inbox that will stay empty.
      return apiOk({
        sent: false,
        reason: result.reason,
        devLink: result.devLink,
        message:
          'Email is not configured on this server, so no message was sent. ' +
          'Set RESEND_API_KEY and MAIL_FROM to enable email.',
      });
    }

    // Deliberately generic on success: the response says nothing about whether
    // this address already had an account.
    return apiOk({ sent: true });
  } catch (error) {
    if (error instanceof MailNotConfiguredError) {
      return apiError('UPSTREAM_ERROR', error.message, {
        configuration: 'RESEND_API_KEY',
      });
    }
    return serverError('POST /api/auth/request', error);
  }
}
