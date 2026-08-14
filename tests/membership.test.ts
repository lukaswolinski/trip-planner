/**
 * Authorization for trip mates — the riskiest change in the app.
 *
 * These are database-backed on purpose. The guarantee being tested is a SQL
 * predicate (`editableBy` in lib/trips/repository.ts), so a mocked test would
 * only prove that the mock agrees with itself. Every case here goes through the
 * same repository functions the route handlers call.
 *
 * Requires DATABASE_URL; skips rather than fails without one, so `npm test`
 * stays green during first-time setup.
 *
 * ⚠️ Point DATABASE_URL at a DEDICATED TEST DATABASE.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb, type Database } from '@/lib/db';
import { sessions, tripMembers, trips, users } from '@/lib/db/schema';
import type { SessionContext } from '@/lib/auth/session';
import { getLimits } from '@/lib/limits';
import {
  deleteTrip,
  getOwnedTrip,
  getTripByShareSlug,
  listTrips,
  newShareSlug,
  patchTrip,
  setShareSlug,
} from '@/lib/trips/repository';
import {
  acceptInvitations,
  addExpense,
  budgetSummary,
  evenShares,
  inviteMember,
  removeMember,
  setBudget,
} from '@/lib/trips/members';

const hasDb = Boolean(process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

let db: Database;
const createdSessions: string[] = [];
const createdUsers: string[] = [];

function ctx(sessionId: string, userId: string | null = null): SessionContext {
  return { sessionId, userId, email: null, tier: 'free', limits: getLimits('free') };
}

async function makeUser(): Promise<{ id: string; email: string }> {
  const email = `member-${randomUUID()}@example.test`;
  const [user] = await db
    .insert(users)
    .values({ email })
    .returning({ id: users.id, email: users.email });
  createdUsers.push(user.id);
  return user;
}

async function makeSession(userId: string | null = null): Promise<string> {
  const id = randomUUID();
  await db.insert(sessions).values({ id, userId });
  createdSessions.push(id);
  return id;
}

beforeAll(async () => {
  if (!hasDb) return;
  db = getDb();
});

afterAll(async () => {
  if (!hasDb) return;
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

/** Owner with an account, plus an outsider who has one too. */
async function scenario() {
  const owner = await makeUser();
  const ownerSession = await makeSession(owner.id);
  const [trip] = await db
    .insert(trips)
    .values({ sessionId: ownerSession, userId: owner.id, title: 'Shared trip' })
    .returning();

  const outsider = await makeUser();
  const outsiderSession = await makeSession(outsider.id);

  return {
    owner,
    ownerCtx: ctx(ownerSession, owner.id),
    trip,
    outsider,
    outsiderCtx: ctx(outsiderSession, outsider.id),
  };
}

suite('trip mate authorization', () => {
  it('a non-member cannot read or write the trip', async () => {
    const s = await scenario();

    // Resolution is the gate: every route handler calls this before acting, so
    // a null here is what stops the write from ever being attempted.
    expect(await getOwnedTrip(db, s.trip.id, s.outsiderCtx)).toBeNull();

    const patched = await patchTrip(db, s.trip.id, s.outsiderCtx, {
      title: 'Hijacked',
      version: s.trip.version,
    });
    expect(patched.status).toBe('not_found');

    expect(await deleteTrip(db, s.trip.id, s.outsiderCtx)).toBe(false);

    // The trip never appears in the outsider's list either.
    const list = await listTrips(db, s.outsiderCtx);
    expect(list.some((t) => t.id === s.trip.id)).toBe(false);

    // And it is genuinely still there — the failed calls changed nothing.
    const stillOwned = await getOwnedTrip(db, s.trip.id, s.ownerCtx);
    expect(stillOwned?.title).toBe('Shared trip');
  });

  it('a pending invitation grants nothing until it is accepted', async () => {
    const s = await scenario();
    await inviteMember(db, s.trip.id, s.outsider.email, s.owner.id);

    // Invited, but has not proved they hold the address.
    expect(await getOwnedTrip(db, s.trip.id, s.outsiderCtx)).toBeNull();
  });

  it('an accepted member can read and write', async () => {
    const s = await scenario();
    await inviteMember(db, s.trip.id, s.outsider.email, s.owner.id);
    const bound = await acceptInvitations(db, s.outsider.id, s.outsider.email);
    expect(bound).toBe(1);

    const seen = await getOwnedTrip(db, s.trip.id, s.outsiderCtx);
    expect(seen?.id).toBe(s.trip.id);

    const patched = await patchTrip(db, s.trip.id, s.outsiderCtx, {
      title: 'Renamed by a trip mate',
      version: s.trip.version,
    });
    expect(patched.status).toBe('ok');
    expect(patched.status === 'ok' && patched.trip.title).toBe(
      'Renamed by a trip mate',
    );

    // And it shows up in their trip list.
    const list = await listTrips(db, s.outsiderCtx);
    expect(list.some((t) => t.id === s.trip.id)).toBe(true);
  });

  it('a removed member loses access immediately', async () => {
    const s = await scenario();
    const { member } = await inviteMember(db, s.trip.id, s.outsider.email, s.owner.id);
    await acceptInvitations(db, s.outsider.id, s.outsider.email);
    expect(await getOwnedTrip(db, s.trip.id, s.outsiderCtx)).not.toBeNull();

    expect(await removeMember(db, s.trip.id, member.id)).toBe(true);

    // No cache to expire and no token to revoke — the next call already fails.
    expect(await getOwnedTrip(db, s.trip.id, s.outsiderCtx)).toBeNull();
    const patched = await patchTrip(db, s.trip.id, s.outsiderCtx, {
      title: 'Still here?',
      version: s.trip.version,
    });
    expect(patched.status).toBe('not_found');
  });

  it('a share slug still grants no write access', async () => {
    const s = await scenario();
    const slug = newShareSlug();
    await setShareSlug(db, s.trip.id, s.ownerCtx, slug);

    // The slug reads. That is its entire capability.
    const viaSlug = await getTripByShareSlug(db, slug);
    expect(viaSlug?.id).toBe(s.trip.id);

    /*
     * Someone holding the slug is, as far as authorization is concerned, just
     * an unrelated visitor: the slug never enters the predicate. Their context
     * comes from their own cookie, and it does not match.
     */
    const visitorSession = await makeSession();
    const visitorCtx = ctx(visitorSession);

    expect(await getOwnedTrip(db, s.trip.id, visitorCtx)).toBeNull();
    expect(
      (await patchTrip(db, s.trip.id, visitorCtx, { title: 'x', version: 0 })).status,
    ).toBe('not_found');
    expect(await deleteTrip(db, s.trip.id, visitorCtx)).toBe(false);

    // Even a signed-in visitor holding the slug gets nothing.
    expect(await getOwnedTrip(db, s.trip.id, s.outsiderCtx)).toBeNull();
  });

  it('an anonymous session can never become a member', async () => {
    const s = await scenario();
    const anonSession = await makeSession(null);
    const anonCtx = ctx(anonSession, null);

    // Invite the address, and even accept it for a *different* user.
    await inviteMember(db, s.trip.id, s.outsider.email, s.owner.id);
    await acceptInvitations(db, s.outsider.id, s.outsider.email);

    // The anonymous visitor has no user id, so the membership arm cannot match.
    expect(await getOwnedTrip(db, s.trip.id, anonCtx)).toBeNull();
  });

  it('membership is per trip, not global', async () => {
    const s = await scenario();
    const [other] = await db
      .insert(trips)
      .values({
        sessionId: s.ownerCtx.sessionId,
        userId: s.owner.id,
        title: 'Not shared',
      })
      .returning();

    await inviteMember(db, s.trip.id, s.outsider.email, s.owner.id);
    await acceptInvitations(db, s.outsider.id, s.outsider.email);

    expect(await getOwnedTrip(db, s.trip.id, s.outsiderCtx)).not.toBeNull();
    expect(await getOwnedTrip(db, other.id, s.outsiderCtx)).toBeNull();
  });

  it('re-inviting the same address does not create a second membership', async () => {
    const s = await scenario();
    const first = await inviteMember(db, s.trip.id, s.outsider.email, s.owner.id);
    const second = await inviteMember(
      db,
      s.trip.id,
      s.outsider.email.toUpperCase(),
      s.owner.id,
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.member.id).toBe(first.member.id);

    const rows = await db
      .select()
      .from(tripMembers)
      .where(eq(tripMembers.tripId, s.trip.id));
    expect(rows).toHaveLength(1);
  });
});

suite('budget and splits', () => {
  it('tracks spend against the target', async () => {
    const s = await scenario();
    await setBudget(db, s.trip.id, 100_000);

    await addExpense(db, s.trip.id, s.owner.id, {
      description: 'Campsite',
      amountCents: 12_500,
    });
    await addExpense(db, s.trip.id, s.owner.id, {
      description: 'Fuel',
      amountCents: 7_250,
    });

    const summary = await budgetSummary(db, s.trip.id);
    expect(summary.totalCents).toBe(100_000);
    expect(summary.spentCents).toBe(19_750);
    expect(summary.remainingCents).toBe(80_250);
  });

  it('reports no remaining figure when no budget is set', async () => {
    const s = await scenario();
    await addExpense(db, s.trip.id, s.owner.id, {
      description: 'Ferry',
      amountCents: 4_000,
    });

    const summary = await budgetSummary(db, s.trip.id);
    // Null, not zero: "no budget" and "nothing left" are different claims.
    expect(summary.totalCents).toBeNull();
    expect(summary.remainingCents).toBeNull();
    expect(summary.spentCents).toBe(4_000);
  });

  it('splits a bill so the shares sum to the exact total', async () => {
    const s = await scenario();
    const a = await inviteMember(db, s.trip.id, s.owner.email, s.owner.id);
    const b = await inviteMember(db, s.trip.id, s.outsider.email, s.owner.id);

    // 10.00 between two is clean; 10.01 between two is not.
    await addExpense(db, s.trip.id, s.owner.id, {
      description: 'Dinner',
      amountCents: 1_001,
      paidByMemberId: a.member.id,
      splitBetween: [a.member.id, b.member.id],
    });

    const summary = await budgetSummary(db, s.trip.id);
    const shares = summary.expenses[0].shares.map((sh) => sh.shareCents);
    expect(shares).toHaveLength(2);
    expect(shares.reduce((x, y) => x + y, 0)).toBe(1_001);

    const owedTotal = summary.perMember.reduce((sum, m) => sum + m.owedCents, 0);
    expect(owedTotal).toBe(1_001);
    const payer = summary.perMember.find((m) => m.memberId === a.member.id);
    expect(payer?.paidCents).toBe(1_001);
  });

  it('refuses to charge a member of another trip', async () => {
    const s = await scenario();
    const otherOwner = await makeUser();
    const otherSession = await makeSession(otherOwner.id);
    const [otherTrip] = await db
      .insert(trips)
      .values({ sessionId: otherSession, userId: otherOwner.id, title: 'Other' })
      .returning();
    const foreign = await inviteMember(
      db,
      otherTrip.id,
      otherOwner.email,
      otherOwner.id,
    );

    await addExpense(db, s.trip.id, s.owner.id, {
      description: 'Injected',
      amountCents: 500,
      splitBetween: [foreign.member.id],
    });

    const summary = await budgetSummary(db, s.trip.id);
    // The expense is recorded; the foreign member simply is not charged.
    expect(summary.spentCents).toBe(500);
    expect(summary.expenses[0].shares).toHaveLength(0);
  });
});

describe('even split arithmetic', () => {
  it('never loses or invents a cent', () => {
    for (const total of [1, 2, 100, 1_001, 9_999, 123_457]) {
      for (const count of [1, 2, 3, 4, 7]) {
        const shares = evenShares(total, count);
        expect(shares).toHaveLength(count);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        // No share is more than a penny above another.
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('hands the remainder to the earliest members, deterministically', () => {
    expect(evenShares(1_000, 3)).toEqual([334, 333, 333]);
    expect(evenShares(10, 4)).toEqual([3, 3, 2, 2]);
    expect(evenShares(0, 3)).toEqual([0, 0, 0]);
    expect(evenShares(100, 0)).toEqual([]);
  });
});
