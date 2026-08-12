/**
 * The single entry point every protected Route Handler goes through: resolve
 * the session, then check both rate-limit buckets.
 *
 * Having one helper means an endpoint cannot accidentally ship without a limit,
 * and the session-plus-IP pairing is applied consistently.
 */

import { getSessionContext, type SessionContext } from '@/lib/auth/session';
import { getDb, type Database } from '@/lib/db';
import { ipRateKey, sessionRateKey } from '@/lib/ip';
import { checkRateLimits, rateLimitResponse, type BucketCheck } from '@/lib/rate-limit';
import { serverError } from '@/lib/api';

export type LimitedEndpoint = 'writes' | 'routeSummary' | 'geocode';

export type GuardResult =
  | { ok: true; db: Database; context: SessionContext }
  | { ok: false; response: Response };

export async function guard(
  request: Request,
  endpoint: LimitedEndpoint,
): Promise<GuardResult> {
  let db: Database;
  let context: SessionContext;

  try {
    db = getDb();
    context = await getSessionContext();
  } catch (error) {
    return { ok: false, response: serverError('guard/session', error) };
  }

  const rules = context.limits.rate[endpoint];
  const checks: BucketCheck[] = [
    {
      key: sessionRateKey(endpoint, context.sessionId),
      rule: rules.session,
      scope: 'session',
    },
  ];

  // A session is just a cookie, so the IP bucket is what actually holds when
  // someone clears cookies to mint a fresh allowance.
  const ipKey = ipRateKey(endpoint, request.headers);
  if (ipKey) {
    checks.push({ key: ipKey, rule: rules.ip, scope: 'ip' });
  }

  try {
    const decision = await checkRateLimits(db, checks);
    if (!decision.allowed) {
      return { ok: false, response: rateLimitResponse(decision) };
    }
  } catch (error) {
    return { ok: false, response: serverError('guard/rate-limit', error) };
  }

  return { ok: true, db, context };
}

/**
 * IP-only limiter for public endpoints that have no session to key on — the
 * share page's recompute path and magic-link requests.
 */
export async function guardByIpOnly(
  request: Request,
  prefix: string,
  rule: { limit: number; windowSeconds: number },
  extra: BucketCheck[] = [],
): Promise<{ ok: true; db: Database } | { ok: false; response: Response }> {
  let db: Database;
  try {
    db = getDb();
  } catch (error) {
    return { ok: false, response: serverError('guard/db', error) };
  }

  const checks: BucketCheck[] = [...extra];
  const ipKey = ipRateKey(prefix, request.headers);
  if (ipKey) checks.push({ key: ipKey, rule, scope: 'ip' });

  if (checks.length === 0) return { ok: true, db };

  try {
    const decision = await checkRateLimits(db, checks);
    if (!decision.allowed) {
      return { ok: false, response: rateLimitResponse(decision) };
    }
  } catch (error) {
    return { ok: false, response: serverError('guard/rate-limit', error) };
  }

  return { ok: true, db };
}
