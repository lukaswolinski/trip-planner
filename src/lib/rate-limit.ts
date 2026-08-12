/**
 * Postgres-backed fixed-window rate limiting.
 *
 * In-process counters do not work on Vercel: each Lambda instance has its own
 * memory, so a Map-based limiter enforces nothing beyond a single warm
 * instance. The counter has to live somewhere shared, and we already have
 * Postgres.
 *
 * Every protected endpoint checks at least two buckets — session and IP — and
 * is denied if *either* is exhausted. A session is just a cookie, so a
 * session-only limit is a speed bump rather than a limit.
 */

import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import type { RateRule } from '@/lib/limits';

export interface BucketCheck {
  key: string;
  rule: RateRule;
  /** Reported back to the client so the message can be truthful. */
  scope: 'session' | 'ip' | 'email';
}

export interface RateDecision {
  allowed: boolean;
  /** Which bucket ran out, when denied. */
  scope?: BucketCheck['scope'];
  limit?: number;
  retryAfterSeconds?: number;
}

/** Start of the fixed window containing `now`. */
export function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Increments every bucket, then decides.
 *
 * Incrementing all buckets even when an earlier one already failed is
 * deliberate: a client hammering a denied endpoint still accrues counts, so
 * abuse does not get a free pass on the buckets that happened to be checked
 * later.
 */
export async function checkRateLimits(
  db: Database,
  checks: readonly BucketCheck[],
  now: Date = new Date(),
): Promise<RateDecision> {
  let denied: RateDecision | null = null;

  for (const check of checks) {
    const start = windowStart(now, check.rule.windowSeconds);
    const count = await bump(db, check.key, start);

    if (count > check.rule.limit) {
      const resetAt = start.getTime() + check.rule.windowSeconds * 1000;
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((resetAt - now.getTime()) / 1000),
      );
      // Report the first (most specific) bucket that failed.
      denied ??= {
        allowed: false,
        scope: check.scope,
        limit: check.rule.limit,
        retryAfterSeconds,
      };
    }
  }

  return denied ?? { allowed: true };
}

/** Atomic increment-and-read. Returns the count including this request. */
async function bump(db: Database, key: string, start: Date): Promise<number> {
  const rows = await db.execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count)
    values (${key}, ${start.toISOString()}, 1)
    on conflict (key, window_start)
      do update set count = rate_limits.count + 1
    returning count
  `);

  const row = Array.isArray(rows) ? rows[0] : (rows as { count: number }[])[0];
  return Number(row?.count ?? 1);
}

/** 429 with a Retry-After header and a body naming the bucket that was hit. */
export function rateLimitResponse(decision: RateDecision): Response {
  const retryAfter = decision.retryAfterSeconds ?? 60;
  return Response.json(
    {
      error: 'RATE_LIMITED',
      scope: decision.scope,
      limit: decision.limit,
      retryAfterSeconds: retryAfter,
      message:
        decision.scope === 'ip'
          ? 'Too many requests from your network. Please wait and try again.'
          : 'Too many requests. Please wait and try again.',
    },
    { status: 429, headers: { 'Retry-After': String(retryAfter) } },
  );
}
