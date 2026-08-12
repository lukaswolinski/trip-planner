/**
 * The nightly housekeeping sweep, kept out of the route handler so it can be
 * tested directly against a database.
 *
 * Several tables only ever grow — `rate_limits` gains rows every minute — and
 * rows past their window are dead weight that slows queries and costs storage.
 * One of these deletes is not discretionary: `route_legs` older than 30 days
 * must go, because that is Mapbox's cap on retaining routing results.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { CLEANUP_BATCH, RETENTION } from '@/lib/limits';

export interface CleanupCounts {
  abandonedTrips: number;
  sessions: number;
  rateLimits: number;
  magicTokens: number;
  routeLegs: number;
}

export interface CleanupOptions {
  /**
   * Deletes anonymous trips untouched for 180 days.
   *
   * Off by default: it is the only rule here that destroys something a user
   * typed, which makes it a data-retention policy decision rather than a
   * technical one.
   */
  deleteAbandonedTrips?: boolean;
}

export async function runCleanup(
  db: Database,
  options: CleanupOptions = {},
): Promise<CleanupCounts> {
  // Order matters: abandoned trips must go before the sessions that own them.
  const abandonedTrips = options.deleteAbandonedTrips
    ? await deleteBatched(
        db,
        sql`
          delete from trips
          where id in (
            select id from trips
            where user_id is null
              and updated_at < now() - ${interval(RETENTION.abandonedAnonymousTripDays, 'days')}
            limit ${CLEANUP_BATCH}
          )
        `,
      )
    : 0;

  /**
   * Anonymous sessions are only removed once no trip references them.
   *
   * `trips.session_id` is ON DELETE SET NULL and `trips` carries a CHECK that a
   * trip must have a session or a user. Deleting a session that still owns an
   * unclaimed trip would null its last owner and violate that constraint — the
   * delete would fail rather than silently orphan the trip. The `not exists`
   * clause states the intent instead of relying on the constraint to stop us,
   * and crucially a *claimed* trip simply has its `session_id` nulled and
   * survives.
   */
  const sessions = await deleteBatched(
    db,
    sql`
      delete from sessions
      where id in (
        select s.id from sessions s
        where s.user_id is null
          and s.last_seen_at < now() - ${interval(RETENTION.anonymousSessionDays, 'days')}
          and not exists (select 1 from trips t where t.session_id = s.id)
        limit ${CLEANUP_BATCH}
      )
    `,
  );

  const rateLimits = await deleteBatched(
    db,
    sql`
      delete from rate_limits
      where (key, window_start) in (
        select key, window_start from rate_limits
        where window_start < now() - ${interval(RETENTION.rateLimitsHours, 'hours')}
        limit ${CLEANUP_BATCH}
      )
    `,
  );

  const magicTokens = await deleteBatched(
    db,
    sql`
      delete from magic_tokens
      where token_hash in (
        select token_hash from magic_tokens
        where expires_at < now() - ${interval(RETENTION.magicTokensDays, 'days')}
        limit ${CLEANUP_BATCH}
      )
    `,
  );

  // The Mapbox retention obligation.
  const routeLegs = await deleteBatched(
    db,
    sql`
      delete from route_legs
      where id in (
        select id from route_legs
        where fetched_at < now() - ${interval(RETENTION.routeLegsDays, 'days')}
        limit ${CLEANUP_BATCH}
      )
    `,
  );

  return { abandonedTrips, sessions, rateLimits, magicTokens, routeLegs };
}

/**
 * Intervals are built with sql.raw from module constants — never from request
 * input — because Postgres will not accept a bound parameter as an interval
 * literal.
 */
function interval(amount: number, unit: 'days' | 'hours'): SQL {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new Error(`Invalid retention amount: ${amount}`);
  }
  return sql.raw(`interval '${amount} ${unit}'`);
}

/**
 * Runs a batched delete until it stops removing rows, so no single statement
 * holds a long lock on a table that might have millions of rows.
 */
async function deleteBatched(db: Database, statement: SQL): Promise<number> {
  let total = 0;
  for (let pass = 0; pass < 100; pass++) {
    const result = await db.execute(statement);
    const count = rowCount(result);
    total += count;
    if (count < CLEANUP_BATCH) break;
  }
  return total;
}

function rowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  const maybe = result as { count?: number; rowCount?: number } | null;
  return maybe?.count ?? maybe?.rowCount ?? 0;
}
