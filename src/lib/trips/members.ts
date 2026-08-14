/**
 * Trip mates, budget and expenses.
 *
 * Authorization is NOT re-implemented here. Every caller resolves the trip
 * through `getOwnedTrip` first — the one predicate in repository.ts — and these
 * functions then act on a trip id already proven writable. Adding a second
 * ownership check here would mean two places to keep correct.
 */

import { and, asc, eq, sql } from 'drizzle-orm';
import type { Database } from '@/lib/db';
import { expenseShares, expenses, tripMembers, trips, users } from '@/lib/db/schema';

export type TripMemberRow = typeof tripMembers.$inferSelect;
export type ExpenseRow = typeof expenses.$inferSelect;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function listMembers(
  db: Database,
  tripId: string,
): Promise<TripMemberRow[]> {
  return db
    .select()
    .from(tripMembers)
    .where(eq(tripMembers.tripId, tripId))
    .orderBy(asc(tripMembers.invitedAt));
}

/**
 * Invites an address, or returns the existing row if already invited.
 *
 * If the address already belongs to a user we bind it immediately — but we do
 * NOT set `accepted_at`, because being a known user is not the same as having
 * agreed to join. Acceptance still happens when they follow the link.
 */
export async function inviteMember(
  db: Database,
  tripId: string,
  email: string,
  invitedBy: string | null,
): Promise<{ member: TripMemberRow; created: boolean }> {
  const normalized = normalizeEmail(email);

  const [existing] = await db
    .select()
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.email, normalized)))
    .limit(1);
  if (existing) return { member: existing, created: false };

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, normalized))
    .limit(1);

  const [member] = await db
    .insert(tripMembers)
    .values({
      tripId,
      email: normalized,
      userId: user?.id ?? null,
      role: 'editor',
      invitedBy,
    })
    .returning();
  return { member, created: true };
}

export async function removeMember(
  db: Database,
  tripId: string,
  memberId: string,
): Promise<boolean> {
  const removed = await db
    .delete(tripMembers)
    // Scoped by tripId as well as id, so a member id from another trip cannot
    // be removed by guessing it.
    .where(and(eq(tripMembers.id, memberId), eq(tripMembers.tripId, tripId)))
    .returning({ id: tripMembers.id });
  return removed.length > 0;
}

/**
 * Binds pending invitations to a user who has just proved they hold the
 * address, and marks them accepted.
 *
 * Called from the magic-link verify step. This is the only place `accepted_at`
 * is set — access begins when someone demonstrates control of the mailbox, not
 * when an invitation is sent to it.
 */
export async function acceptInvitations(
  db: Database,
  userId: string,
  email: string,
): Promise<number> {
  const bound = await db
    .update(tripMembers)
    .set({ userId, acceptedAt: sql`now()` })
    .where(
      and(
        eq(tripMembers.email, normalizeEmail(email)),
        sql`${tripMembers.acceptedAt} is null`,
      ),
    )
    .returning({ id: tripMembers.id });
  return bound.length;
}

/** Ensures the trip owner appears in the member list, so splits can include them. */
export async function ensureOwnerMember(
  db: Database,
  tripId: string,
  userId: string,
  email: string,
): Promise<TripMemberRow> {
  const normalized = normalizeEmail(email);
  const [existing] = await db
    .select()
    .from(tripMembers)
    .where(and(eq(tripMembers.tripId, tripId), eq(tripMembers.email, normalized)))
    .limit(1);
  if (existing) return existing;

  const [member] = await db
    .insert(tripMembers)
    .values({
      tripId,
      email: normalized,
      userId,
      role: 'owner',
      acceptedAt: sql`now()`,
    })
    .returning();
  return member;
}

// --- Budget -----------------------------------------------------------------

export async function setBudget(
  db: Database,
  tripId: string,
  totalCents: number | null,
): Promise<void> {
  await db
    .update(trips)
    .set({ budgetTotalCents: totalCents })
    .where(eq(trips.id, tripId));
}

export interface ExpenseInput {
  description: string;
  amountCents: number;
  paidByMemberId?: string | null;
  /** Member ids to divide this expense between; empty means nobody is charged. */
  splitBetween?: string[];
}

/**
 * Splits `amountCents` into `count` whole cents that sum to exactly the total.
 *
 * The remainder is handed out one cent at a time to the earliest members rather
 * than rounded per-share: three people splitting £10 owe 334, 333 and 333, not
 * 333 each with a penny that belongs to nobody.
 */
export function evenShares(amountCents: number, count: number): number[] {
  if (count <= 0) return [];
  const base = Math.floor(amountCents / count);
  const remainder = amountCents - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < remainder ? 1 : 0));
}

export async function addExpense(
  db: Database,
  tripId: string,
  createdBy: string | null,
  input: ExpenseInput,
): Promise<ExpenseRow> {
  return db.transaction(async (tx) => {
    const [expense] = await tx
      .insert(expenses)
      .values({
        tripId,
        description: input.description,
        amountCents: input.amountCents,
        paidByMemberId: input.paidByMemberId ?? null,
        createdBy,
      })
      .returning();

    const between = input.splitBetween ?? [];
    if (between.length > 0) {
      // Only members of THIS trip may be charged, so an id from another trip
      // cannot be written in.
      const valid = await tx
        .select({ id: tripMembers.id })
        .from(tripMembers)
        .where(eq(tripMembers.tripId, tripId));
      const allowed = new Set(valid.map((row) => row.id));
      const targets = between.filter((id) => allowed.has(id));

      if (targets.length > 0) {
        const shares = evenShares(input.amountCents, targets.length);
        await tx.insert(expenseShares).values(
          targets.map((memberId, index) => ({
            expenseId: expense.id,
            memberId,
            shareCents: shares[index],
          })),
        );
      }
    }

    return expense;
  });
}

export async function deleteExpense(
  db: Database,
  tripId: string,
  expenseId: string,
): Promise<boolean> {
  const removed = await db
    .delete(expenses)
    .where(and(eq(expenses.id, expenseId), eq(expenses.tripId, tripId)))
    .returning({ id: expenses.id });
  return removed.length > 0;
}

export interface BudgetSummary {
  totalCents: number | null;
  currency: string;
  spentCents: number;
  remainingCents: number | null;
  expenses: Array<
    ExpenseRow & { shares: Array<{ memberId: string; shareCents: number }> }
  >;
  /** Per member: what they paid, and what they owe across all splits. */
  perMember: Array<{
    memberId: string;
    email: string;
    paidCents: number;
    owedCents: number;
  }>;
}

export async function budgetSummary(
  db: Database,
  tripId: string,
): Promise<BudgetSummary> {
  const [trip] = await db
    .select({
      totalCents: trips.budgetTotalCents,
      currency: trips.budgetCurrency,
    })
    .from(trips)
    .where(eq(trips.id, tripId))
    .limit(1);

  const rows = await db
    .select()
    .from(expenses)
    .where(eq(expenses.tripId, tripId))
    .orderBy(asc(expenses.createdAt));

  const shareRows = rows.length
    ? await db
        .select()
        .from(expenseShares)
        .where(
          sql`${expenseShares.expenseId} in (${sql.join(
            rows.map((r) => sql`${r.id}`),
            sql`, `,
          )})`,
        )
    : [];

  const members = await listMembers(db, tripId);

  const paid = new Map<string, number>();
  const owed = new Map<string, number>();
  let spentCents = 0;

  for (const expense of rows) {
    spentCents += expense.amountCents;
    if (expense.paidByMemberId) {
      paid.set(
        expense.paidByMemberId,
        (paid.get(expense.paidByMemberId) ?? 0) + expense.amountCents,
      );
    }
  }
  for (const share of shareRows) {
    owed.set(share.memberId, (owed.get(share.memberId) ?? 0) + share.shareCents);
  }

  const byExpense = new Map<string, Array<{ memberId: string; shareCents: number }>>();
  for (const share of shareRows) {
    const list = byExpense.get(share.expenseId) ?? [];
    list.push({ memberId: share.memberId, shareCents: share.shareCents });
    byExpense.set(share.expenseId, list);
  }

  return {
    totalCents: trip?.totalCents ?? null,
    currency: trip?.currency ?? 'USD',
    spentCents,
    remainingCents:
      trip?.totalCents === null || trip?.totalCents === undefined
        ? null
        : trip.totalCents - spentCents,
    expenses: rows.map((row) => ({ ...row, shares: byExpense.get(row.id) ?? [] })),
    perMember: members.map((member) => ({
      memberId: member.id,
      email: member.email,
      paidCents: paid.get(member.id) ?? 0,
      owedCents: owed.get(member.id) ?? 0,
    })),
  };
}
