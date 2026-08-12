/**
 * Magic-link sign-in, and the trip-claiming transaction it exists to perform.
 *
 * Hand-rolled rather than pulled from an auth library because there is exactly
 * one flow, and it has an unusual requirement: verifying must adopt an
 * anonymous cookie session's trips into a real account, atomically.
 */

import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { magicTokens, sessions, trips, users } from '@/lib/db/schema';

/** 15 minutes. Long enough to find the email, short enough to limit exposure. */
const TOKEN_TTL_MS = 15 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Only the hash is stored, so a database leak cannot be replayed as a login. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createMagicToken(
  db: Database,
  email: string,
  sessionId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await db.insert(magicTokens).values({
    tokenHash: hashToken(token),
    email: normalizeEmail(email),
    sessionId,
    expiresAt,
  });

  return { token, expiresAt };
}

export interface VerifiedLogin {
  userId: string;
  email: string;
  claimedTripCount: number;
}

/**
 * Consumes a token and claims trips, all in one transaction.
 *
 * `currentSessionId` is the session of the browser that clicked the link, which
 * may differ from the session that requested it (people open email on their
 * phone). Both get attached to the user: the requesting session so its trips
 * are claimed, the clicking session so that browser is signed in.
 */
export async function verifyMagicToken(
  db: Database,
  token: string,
  currentSessionId: string,
): Promise<VerifiedLogin | null> {
  const tokenHash = hashToken(token);

  return db.transaction(async (tx) => {
    // Single-use: the update only matches an unused, unexpired token, so a
    // replayed link finds nothing.
    const [consumed] = await tx
      .update(magicTokens)
      .set({ usedAt: sql`now()` })
      .where(
        and(
          eq(magicTokens.tokenHash, tokenHash),
          isNull(magicTokens.usedAt),
          gt(magicTokens.expiresAt, sql`now()`),
        ),
      )
      .returning({
        email: magicTokens.email,
        sessionId: magicTokens.sessionId,
      });

    if (!consumed) return null;

    const [user] = await tx
      .insert(users)
      .values({ email: consumed.email })
      .onConflictDoUpdate({
        target: users.email,
        // A no-op update so the row is returned on conflict.
        set: { email: consumed.email },
      })
      .returning({ id: users.id, email: users.email });

    // Sign in both the requesting and the clicking session.
    for (const sessionId of new Set([consumed.sessionId, currentSessionId])) {
      await tx
        .update(sessions)
        .set({ userId: user.id, lastSeenAt: sql`now()` })
        .where(eq(sessions.id, sessionId));
    }

    const claimed = await tx
      .update(trips)
      .set({ userId: user.id })
      .where(and(eq(trips.sessionId, consumed.sessionId), isNull(trips.userId)))
      .returning({ id: trips.id });

    return {
      userId: user.id,
      email: user.email,
      claimedTripCount: claimed.length,
    };
  });
}
