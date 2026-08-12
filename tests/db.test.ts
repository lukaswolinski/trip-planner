/**
 * Database-backed tests: authorization isolation, reorder integrity, rate-limit
 * buckets, and cleanup safety.
 *
 * These require a real Postgres. Set DATABASE_URL and run `npm run db:migrate`
 * first; without it the whole file skips rather than failing, so `npm test`
 * stays green during first-time setup.
 *
 * ⚠️ Point DATABASE_URL at a DEDICATED TEST DATABASE. The cleanup tests call
 * runCleanup(), which deletes old rows across the entire database, not just the
 * fixtures created here.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { getDb, type Database } from '@/lib/db';
import { magicTokens, rateLimits, routeLegs, sessions, stops, trips, users } from '@/lib/db/schema';
import type { SessionContext } from '@/lib/auth/session';
import { getLimits } from '@/lib/limits';
import {
  addStop,
  deleteTrip,
  getOwnedTrip,
  listStops,
  listTrips,
  patchStop,
  patchTrip,
  reorderStops,
  setShareSlug,
  newShareSlug,
  getTripByShareSlug,
} from '@/lib/trips/repository';
import { runCleanup } from '@/lib/cleanup';
import { checkRateLimits } from '@/lib/rate-limit';

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

if (!hasDb) {
  console.info(
    '[tests] Skipping database tests: DATABASE_URL is not set. ' +
      'Set it to a dedicated test database and run `npm run db:migrate` to enable them.',
  );
}

let db: Database;

/** Tracks fixtures so each run cleans up after itself. */
const createdSessions: string[] = [];
const createdUsers: string[] = [];

function ctx(sessionId: string, userId: string | null = null): SessionContext {
  return { sessionId, userId, email: null, tier: 'free', limits: getLimits('free') };
}

async function makeSession(userId: string | null = null): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({ id, userId });
  createdSessions.push(id);
  return id;
}

async function makeUser(): Promise<string> {
  const email = `test-${randomUUID()}@example.test`;
  const [user] = await db.insert(users).values({ email }).returning({ id: users.id });
  createdUsers.push(user.id);
  return user.id;
}

async function makeTrip(sessionId: string, userId: string | null = null) {
  const [trip] = await db
    .insert(trips)
    .values({ sessionId, userId, title: 'Test trip' })
    .returning();
  return trip;
}

beforeAll(async () => {
  if (!hasDb) return;
  db = getDb();
  // Fail loudly and usefully if migrations have not been applied.
  try {
    await db.select({ n: sql<number>`1` }).from(trips).limit(1);
  } catch (error) {
    throw new Error(
      'Could not query the `trips` table. Run `npm run db:migrate` against DATABASE_URL first.',
      { cause: error },
    );
  }
});

afterAll(async () => {
  if (!hasDb) return;
  // Trips cascade from sessions only when unclaimed, so remove them explicitly.
  for (const sessionId of createdSessions) {
    await db.delete(trips).where(eq(trips.sessionId, sessionId));
  }
  for (const userId of createdUsers) {
    await db.delete(trips).where(eq(trips.userId, userId));
  }
  for (const sessionId of createdSessions) {
    await db.delete(sessions).where(eq(sessions.id, sessionId));
  }
  for (const userId of createdUsers) {
    await db.delete(users).where(eq(users.id, userId));
  }
});

suite('authorization isolation', () => {
  it('does not let one session read another session trip', async () => {
    const a = await makeSession();
    const b = await makeSession();
    const trip = await makeTrip(a);

    expect(await getOwnedTrip(db, trip.id, ctx(a))).not.toBeNull();
    expect(await getOwnedTrip(db, trip.id, ctx(b))).toBeNull();
  });

  it('does not let one session patch another session trip', async () => {
    const a = await makeSession();
    const b = await makeSession();
    const trip = await makeTrip(a);

    const result = await patchTrip(db, trip.id, ctx(b), {
      title: 'Hijacked',
      version: trip.version,
    });
    expect(result.status).toBe('not_found');

    const [after] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(after.title).toBe('Test trip');
  });

  it('does not let one session delete another session trip', async () => {
    const a = await makeSession();
    const b = await makeSession();
    const trip = await makeTrip(a);

    expect(await deleteTrip(db, trip.id, ctx(b))).toBe(false);
    expect(await getOwnedTrip(db, trip.id, ctx(a))).not.toBeNull();
  });

  it('lets the claiming user reach a trip whose session_id was nulled', async () => {
    const userId = await makeUser();
    const sessionId = await makeSession(userId);
    const trip = await makeTrip(sessionId, userId);

    await db.update(trips).set({ sessionId: null }).where(eq(trips.id, trip.id));

    const otherSession = await makeSession(userId);
    expect(await getOwnedTrip(db, trip.id, ctx(otherSession, userId))).not.toBeNull();
  });

  it('rejects a version mismatch instead of clobbering a concurrent edit', async () => {
    const sessionId = await makeSession();
    const trip = await makeTrip(sessionId);

    const first = await patchTrip(db, trip.id, ctx(sessionId), {
      title: 'Renamed once',
      version: trip.version,
    });
    expect(first.status).toBe('ok');

    // A second tab still holding the old version must not win.
    const second = await patchTrip(db, trip.id, ctx(sessionId), {
      title: 'Renamed from a stale tab',
      version: trip.version,
    });
    expect(second.status).toBe('conflict');
  });

  it('grants no write path via a share slug', async () => {
    const sessionId = await makeSession();
    const other = await makeSession();
    const trip = await makeTrip(sessionId);
    const slug = newShareSlug();
    await setShareSlug(db, trip.id, ctx(sessionId), slug);

    // The slug resolves for reading...
    const found = await getTripByShareSlug(db, slug);
    expect(found?.id).toBe(trip.id);

    // ...but confers nothing on a different session.
    expect(await getOwnedTrip(db, trip.id, ctx(other))).toBeNull();
    expect(await deleteTrip(db, trip.id, ctx(other))).toBe(false);
  });
});

suite('trip list', () => {
  it('reports the real stop count per trip', async () => {
    /*
     * Regression: stopCount came from a correlated subquery whose columns Drizzle
     * rendered unqualified, so it compared stops.trip_id to stops.id and was
     * always 0 — every trip in the list claimed "0 stops".
     */
    const sessionId = await makeSession();
    const withStops = await makeTrip(sessionId);
    const empty = await makeTrip(sessionId);

    for (let i = 0; i < 3; i++) {
      await addStop(db, withStops.id, { name: `S${i}`, lat: 39 + i, lng: -104 - i }, 500);
    }

    const listed = await listTrips(db, ctx(sessionId));
    const counts = new Map(listed.map((t) => [t.id, t.stopCount]));

    expect(counts.get(withStops.id)).toBe(3);
    expect(counts.get(empty.id)).toBe(0);
  });

  it('lists a trip once, not once per stop', async () => {
    // The GROUP BY is what keeps the join from multiplying rows.
    const sessionId = await makeSession();
    const trip = await makeTrip(sessionId);
    for (let i = 0; i < 4; i++) {
      await addStop(db, trip.id, { name: `S${i}`, lat: 39 + i, lng: -104 - i }, 500);
    }

    const listed = await listTrips(db, ctx(sessionId));
    expect(listed.filter((t) => t.id === trip.id)).toHaveLength(1);
  });
});

suite('stop positions and reorder integrity', () => {
  it('keeps positions contiguous through insert and delete', async () => {
    const sessionId = await makeSession();
    const trip = await makeTrip(sessionId);

    for (let i = 0; i < 5; i++) {
      await addStop(db, trip.id, { name: `Stop ${i}`, lat: 39 + i, lng: -104 - i }, 500);
    }
    let current = await listStops(db, trip.id);
    expect(current.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);

    // Insert in the middle.
    await addStop(
      db,
      trip.id,
      { name: 'Inserted', lat: 50, lng: -100, position: 2 },
      500,
    );
    current = await listStops(db, trip.id);
    expect(current.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(current[2].name).toBe('Inserted');

    // Remove from the middle; the gap must close.
    const { deleteStop } = await import('@/lib/trips/repository');
    await deleteStop(db, trip.id, current[2].id);
    current = await listStops(db, trip.id);
    expect(current.map((s) => s.position)).toEqual([0, 1, 2, 3, 4]);
  });

  it('rejects an ordering containing a stop from another trip', async () => {
    const sessionId = await makeSession();
    const mine = await makeTrip(sessionId);
    const theirsSession = await makeSession();
    const theirs = await makeTrip(theirsSession);

    const a = await addStop(db, mine.id, { name: 'A', lat: 39, lng: -104 }, 500);
    const b = await addStop(db, mine.id, { name: 'B', lat: 40, lng: -105 }, 500);
    const foreign = await addStop(db, theirs.id, { name: 'X', lat: 41, lng: -106 }, 500);

    if (a.status !== 'ok' || b.status !== 'ok' || foreign.status !== 'ok') {
      throw new Error('fixture setup failed');
    }

    const result = await reorderStops(db, mine.id, [b.stop.id, foreign.stop.id]);
    expect(result.status).toBe('mismatch');

    // The foreign stop must not have moved trips.
    const [stillTheirs] = await db.select().from(stops).where(eq(stops.id, foreign.stop.id));
    expect(stillTheirs.tripId).toBe(theirs.id);
  });

  it('rejects a partial ordering and duplicate ids', async () => {
    const sessionId = await makeSession();
    const trip = await makeTrip(sessionId);
    const a = await addStop(db, trip.id, { name: 'A', lat: 39, lng: -104 }, 500);
    await addStop(db, trip.id, { name: 'B', lat: 40, lng: -105 }, 500);
    if (a.status !== 'ok') throw new Error('fixture setup failed');

    expect((await reorderStops(db, trip.id, [a.stop.id])).status).toBe('mismatch');
    expect(
      (await reorderStops(db, trip.id, [a.stop.id, a.stop.id])).status,
    ).toBe('mismatch');
  });

  it('applies a valid full reordering', async () => {
    const sessionId = await makeSession();
    const trip = await makeTrip(sessionId);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const added = await addStop(
        db,
        trip.id,
        { name: `S${i}`, lat: 39 + i, lng: -104 - i },
        500,
      );
      if (added.status !== 'ok') throw new Error('fixture setup failed');
      ids.push(added.stop.id);
    }

    const reversed = [...ids].reverse();
    expect((await reorderStops(db, trip.id, reversed)).status).toBe('ok');
    const after = await listStops(db, trip.id);
    expect(after.map((s) => s.id)).toEqual(reversed);
    expect(after.map((s) => s.position)).toEqual([0, 1, 2, 3]);
  });

  it('scopes a stop patch to its own trip', async () => {
    const sessionId = await makeSession();
    const mine = await makeTrip(sessionId);
    const theirs = await makeTrip(await makeSession());
    const foreign = await addStop(db, theirs.id, { name: 'X', lat: 41, lng: -106 }, 500);
    if (foreign.status !== 'ok') throw new Error('fixture setup failed');

    // Correct stop id, wrong trip id — must not match.
    expect(await patchStop(db, mine.id, foreign.stop.id, { name: 'Renamed' })).toBeNull();
    const [unchanged] = await db.select().from(stops).where(eq(stops.id, foreign.stop.id));
    expect(unchanged.name).toBe('X');
  });
});

suite('rate limit buckets', () => {
  /*
   * `now` is pinned for every call in these tests. Without it they are flaky:
   * each database round trip takes ~100ms, so four calls span half a second, and
   * if a fixed-window boundary falls in the middle the counter resets and the
   * request that should have been denied is allowed. Pinning the clock tests the
   * limiter rather than the wall time.
   */
  const NOW = new Date('2026-06-15T12:00:30Z');

  it('allows up to the limit then denies', async () => {
    const key = `test:${randomUUID()}`;
    const rule = { limit: 3, windowSeconds: 60 };

    for (let i = 0; i < 3; i++) {
      const decision = await checkRateLimits(db, [{ key, rule, scope: 'session' }], NOW);
      expect(decision.allowed).toBe(true);
    }

    const denied = await checkRateLimits(db, [{ key, rule, scope: 'session' }], NOW);
    expect(denied.allowed).toBe(false);
    expect(denied.scope).toBe('session');
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);

    await db.delete(rateLimits).where(eq(rateLimits.key, key));
  });

  it('starts a fresh allowance in the next window', async () => {
    const key = `test:${randomUUID()}`;
    const rule = { limit: 1, windowSeconds: 60 };

    expect((await checkRateLimits(db, [{ key, rule, scope: 'session' }], NOW)).allowed).toBe(
      true,
    );
    expect((await checkRateLimits(db, [{ key, rule, scope: 'session' }], NOW)).allowed).toBe(
      false,
    );

    const nextWindow = new Date(NOW.getTime() + 60_000);
    expect(
      (await checkRateLimits(db, [{ key, rule, scope: 'session' }], nextWindow)).allowed,
    ).toBe(true);

    await db.delete(rateLimits).where(eq(rateLimits.key, key));
  });

  it('denies on the IP bucket even when the session bucket is fresh', async () => {
    // This is the hole a session-only limiter leaves: clearing cookies gives a
    // brand new session key, but the IP key is unchanged.
    const ipKey = `test-ip:${randomUUID()}`;
    const ipRule = { limit: 2, windowSeconds: 60 };
    const sessionRule = { limit: 100, windowSeconds: 60 };

    for (let i = 0; i < 2; i++) {
      const decision = await checkRateLimits(
        db,
        [
          { key: `test-sess:${randomUUID()}`, rule: sessionRule, scope: 'session' },
          { key: ipKey, rule: ipRule, scope: 'ip' },
        ],
        NOW,
      );
      expect(decision.allowed).toBe(true);
    }

    const denied = await checkRateLimits(
      db,
      [
        { key: `test-sess:${randomUUID()}`, rule: sessionRule, scope: 'session' },
        { key: ipKey, rule: ipRule, scope: 'ip' },
      ],
      NOW,
    );
    expect(denied.allowed).toBe(false);
    expect(denied.scope).toBe('ip');

    await db.delete(rateLimits).where(eq(rateLimits.key, ipKey));
  });
});

suite('cleanup safety', () => {
  it('keeps a claimed trip when its old session is swept, nulling session_id', async () => {
    const userId = await makeUser();
    const sessionId = await makeSession(userId);
    const trip = await makeTrip(sessionId, userId);

    // Age the session past the retention window, and make it look anonymous so
    // the sweep is eligible to consider it.
    await db
      .update(sessions)
      .set({ userId: null, lastSeenAt: sql`now() - interval '100 days'` })
      .where(eq(sessions.id, sessionId));

    await runCleanup(db, { deleteAbandonedTrips: false });

    const [survivor] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(survivor).toBeDefined();
    expect(survivor.userId).toBe(userId);

    // Either the session was deleted (session_id nulled) or it was correctly
    // left alone because the trip still referenced it. Both keep the trip.
    const remaining = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    if (remaining.length === 0) {
      expect(survivor.sessionId).toBeNull();
    } else {
      expect(survivor.sessionId).toBe(sessionId);
    }
  });

  it('does not delete an old anonymous session that still owns an unclaimed trip', async () => {
    // Deleting it would null the trip's only owner and violate the CHECK
    // constraint, so the sweep must skip it while the trip exists.
    const sessionId = await makeSession();
    const trip = await makeTrip(sessionId);
    await db
      .update(sessions)
      .set({ lastSeenAt: sql`now() - interval '100 days'` })
      .where(eq(sessions.id, sessionId));

    await runCleanup(db, { deleteAbandonedTrips: false });

    const stillThere = await db.select().from(sessions).where(eq(sessions.id, sessionId));
    expect(stillThere).toHaveLength(1);
    const [stillTrip] = await db.select().from(trips).where(eq(trips.id, trip.id));
    expect(stillTrip).toBeDefined();
  });

  it('removes route_legs past the 30-day Mapbox retention cap', async () => {
    const fresh = { profile: 'driving', fromLat: '1.00000', fromLng: '1.00000', toLat: '2.00000', toLng: '2.00000' };
    const stale = { profile: 'driving', fromLat: '3.00000', fromLng: '3.00000', toLat: '4.00000', toLng: '4.00000' };

    await db.delete(routeLegs).where(
      sql`(${routeLegs.fromLat}, ${routeLegs.fromLng}) in ((1.00000, 1.00000), (3.00000, 3.00000))`,
    );

    await db.insert(routeLegs).values([
      { ...fresh, distanceM: 1000, durationS: 60, geometry: 'abc', fetchedAt: new Date() },
      {
        ...stale,
        distanceM: 1000,
        durationS: 60,
        geometry: 'abc',
        fetchedAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000),
      },
    ]);

    await runCleanup(db, { deleteAbandonedTrips: false });

    const freshRows = await db
      .select()
      .from(routeLegs)
      .where(and(eq(routeLegs.fromLat, '1.00000'), eq(routeLegs.fromLng, '1.00000')));
    const staleRows = await db
      .select()
      .from(routeLegs)
      .where(and(eq(routeLegs.fromLat, '3.00000'), eq(routeLegs.fromLng, '3.00000')));

    expect(freshRows).toHaveLength(1);
    expect(staleRows).toHaveLength(0);

    await db
      .delete(routeLegs)
      .where(and(eq(routeLegs.fromLat, '1.00000'), eq(routeLegs.fromLng, '1.00000')));
  });

  it('prunes stale rate-limit windows but keeps current ones', async () => {
    const oldKey = `test-old:${randomUUID()}`;
    const newKey = `test-new:${randomUUID()}`;

    await db.insert(rateLimits).values([
      { key: oldKey, windowStart: new Date(Date.now() - 5 * 60 * 60 * 1000), count: 9 },
      { key: newKey, windowStart: new Date(), count: 1 },
    ]);

    await runCleanup(db, { deleteAbandonedTrips: false });

    expect(await db.select().from(rateLimits).where(eq(rateLimits.key, oldKey))).toHaveLength(0);
    expect(await db.select().from(rateLimits).where(eq(rateLimits.key, newKey))).toHaveLength(1);

    await db.delete(rateLimits).where(eq(rateLimits.key, newKey));
  });

  it('removes long-expired magic tokens', async () => {
    const sessionId = await makeSession();
    const hash = `test-${randomUUID()}`;
    await db.insert(magicTokens).values({
      tokenHash: hash,
      email: 'expired@example.test',
      sessionId,
      expiresAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });

    await runCleanup(db, { deleteAbandonedTrips: false });

    expect(
      await db.select().from(magicTokens).where(eq(magicTokens.tokenHash, hash)),
    ).toHaveLength(0);
  });
});
