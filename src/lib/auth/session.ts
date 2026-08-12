/**
 * Session resolution: cookie -> `sessions` row -> optional user and tier.
 *
 * The proxy mints the cookie on first page load, but this also mints one if it
 * is missing, so an API call that arrives before any page load still works.
 */

import { cookies } from 'next/headers';
import { eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/lib/db';
import { sessions, users } from '@/lib/db/schema';
import { getLimits, isTier, type Limits, type Tier } from '@/lib/limits';
import {
  SESSION_COOKIE,
  newSessionId,
  sessionCookieOptions,
  signSessionId,
  verifySessionCookie,
} from './cookie';

export interface SessionContext {
  sessionId: string;
  /** Null while anonymous. */
  userId: string | null;
  email: string | null;
  tier: Tier;
  limits: Limits;
}

/**
 * `cookies()` is async-only in Next 16 — synchronous access was removed.
 */
export async function getSessionContext(): Promise<SessionContext> {
  const store = await cookies();
  let sessionId = verifySessionCookie(store.get(SESSION_COOKIE)?.value);

  if (!sessionId) {
    sessionId = newSessionId();
    try {
      store.set(SESSION_COOKIE, signSessionId(sessionId), sessionCookieOptions());
    } catch {
      // Server Components cannot set cookies during render. The proxy already
      // handles that path; here we just proceed with the id we generated.
    }
  }

  const db = getDb();
  await ensureSessionRow(db, sessionId);

  const [row] = await db
    .select({
      sessionId: sessions.id,
      userId: sessions.userId,
      email: users.email,
      tier: users.tier,
    })
    .from(sessions)
    .leftJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const tier: Tier = isTier(row?.tier) ? row.tier : 'free';

  return {
    sessionId,
    userId: row?.userId ?? null,
    email: row?.email ?? null,
    tier,
    limits: getLimits(tier),
  };
}

/**
 * Creates the row if absent. `last_seen_at` is only refreshed once an hour, so
 * a burst of API calls does not turn into a write per request.
 */
async function ensureSessionRow(db: Database, sessionId: string): Promise<void> {
  await db
    .insert(sessions)
    .values({ id: sessionId })
    .onConflictDoUpdate({
      target: sessions.id,
      set: { lastSeenAt: sql`now()` },
      setWhere: sql`${sessions.lastSeenAt} < now() - interval '1 hour'`,
    });
}

/** True once the visitor has claimed their trips with an email address. */
export function isClaimed(context: SessionContext): boolean {
  return context.userId !== null;
}
