import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { getOwnedTrip, listStops, type StopRow, type TripRow } from '@/lib/trips/repository';
import { uuidSchema } from '@/lib/validation/schemas';
import { estimateAgeDays, summarizeTrip } from '@/lib/routing/service';
import { budgetSummary, ensureOwnerMember, listMembers } from '@/lib/trips/members';
import { appUrl } from '@/lib/app-url';
import TripEditor from '@/components/TripEditor';
import type { StopDto, SummaryDto, TripDto } from '@/types';

export const dynamic = 'force-dynamic';

export default async function TripPage({ params }: PageProps<'/trips/[id]'>) {
  // `params` is a Promise in Next 16.
  const { id } = await params;

  // `?share=1` is read client-side by TripEditor via useSearchParams, so that
  // arriving at it while already on this page still opens the dialog.
  if (!uuidSchema.safeParse(id).success) notFound();

  const db = getDb();
  const context = await getSessionContext();

  const trip = await getOwnedTrip(db, id, context);
  if (!trip) notFound();

  const stops = await listStops(db, id);

  /**
   * Computed here rather than in a client effect so the totals and per-leg
   * figures are in the initial HTML. A routing failure (an unroutable leg, or a
   * provider outage) must not take the whole editor down — the client can retry
   * on the next action.
   */
  let summary: SummaryDto | null = null;
  try {
    const now = new Date();
    const computed = await summarizeTrip(db, trip, stops, now);
    summary = {
      ...computed,
      legs: computed.legs.map((leg) => ({
        ...leg,
        fetchedAt: leg.fetchedAt.toISOString(),
      })),
      estimatesFetchedAt: computed.estimatesFetchedAt?.toISOString() ?? null,
      estimateAgeDays: estimateAgeDays(computed.estimatesFetchedAt, now),
    };
  } catch (error) {
    console.error('[page] /trips/[id] initial summary', error);
  }

  /*
   * The owner is added to the member list on read so budget splits can include
   * them. Anonymous owners are skipped: membership binds to a user id, which
   * they do not have yet.
   */
  if (context.userId && context.email) {
    await ensureOwnerMember(db, id, context.userId, context.email);
  }
  const [members, budget] = await Promise.all([
    listMembers(db, id),
    budgetSummary(db, id),
  ]);

  return (
    <TripEditor
      trip={serializeTrip(trip)}
      initialStops={stops.map(serializeStop)}
      initialSummary={summary}
      claimed={context.userId !== null}
      softCap={context.limits.maxStops}
      shareBaseUrl={appUrl()}
      members={members.map((m) => ({
        id: m.id,
        email: m.email,
        acceptedAt: m.acceptedAt?.toISOString() ?? null,
      }))}
      budget={{
        ...budget,
        expenses: budget.expenses.map((e) => ({
          id: e.id,
          description: e.description,
          amountCents: e.amountCents,
          paidByMemberId: e.paidByMemberId,
          shares: e.shares,
        })),
      }}
    />
  );
}

function serializeTrip(trip: TripRow): TripDto {
  return {
    id: trip.id,
    title: trip.title,
    defaultProfile: trip.defaultProfile as TripDto['defaultProfile'],
    shareSlug: trip.shareSlug,
    sharedAt: trip.sharedAt?.toISOString() ?? null,
    version: trip.version,
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  };
}

function serializeStop(stop: StopRow): StopDto {
  return {
    id: stop.id,
    tripId: stop.tripId,
    position: stop.position,
    name: stop.name,
    address: stop.address,
    lng: stop.lng,
    lat: stop.lat,
    notes: stop.notes,
    days: stop.days,
    profileToNext: stop.profileToNext as StopDto['profileToNext'],
    createdAt: stop.createdAt.toISOString(),
  };
}
