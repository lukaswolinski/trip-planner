import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getDb } from '@/lib/db';
import { getTripByShareSlug, listStops } from '@/lib/trips/repository';
import { createDbLegCache } from '@/lib/routing/cache';
import { buildTripSummary, nullRouter } from '@/lib/routing/summary';
import { estimateAgeDays, summarizeTrip, toSummaryStops } from '@/lib/routing/service';
import { getLimits, type TravelProfile } from '@/lib/limits';
import { ipRateKey } from '@/lib/ip';
import { checkRateLimits } from '@/lib/rate-limit';
import ReadOnlyTrip from '@/components/ReadOnlyTrip';
import type { StopDto, SummaryDto } from '@/types';

export const dynamic = 'force-dynamic';

/** Shared links shouldn't be indexed — they are unlisted, not public. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function SharedTripPage({ params }: PageProps<'/t/[slug]'>) {
  const { slug } = await params;

  // Slugs are 22-char base64url. Reject anything else before touching the DB.
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(slug)) notFound();

  const db = getDb();
  const trip = await getTripByShareSlug(db, slug);
  if (!trip) notFound();

  const stops = await listStops(db, trip.id);
  const now = new Date();
  const profile = (trip.defaultProfile as TravelProfile) ?? 'driving';

  /**
   * Cache-only first.
   *
   * A share link is public, so recomputing on every view would let anyone burn
   * routing quota by refreshing. Instead: summarise from the cache, and only if
   * something is genuinely missing spend an IP-limited token on a real provider
   * call — which writes its results back, so a viral link causes roughly one
   * recompute per cache lifetime rather than one per visitor.
   */
  let summary = await buildTripSummary(toSummaryStops(stops), profile, {
    cache: createDbLegCache(db),
    router: nullRouter,
    now,
    allowMissingLegs: true,
  });

  let partial = summary.partial;

  if (summary.partial) {
    const rule = getLimits('free').rate.sharePageRecompute.ip;
    const key = ipRateKey('share-recompute', await headers());

    const allowed = key
      ? (await checkRateLimits(db, [{ key, rule, scope: 'ip' }])).allowed
      : false;

    if (allowed) {
      try {
        summary = await summarizeTrip(db, trip, stops, now);
        partial = summary.partial;
      } catch (error) {
        // Leave the partial figures in place and say so, rather than 500ing a
        // page someone shared with their friends.
        console.error('[page] /t/[slug] recompute', error);
      }
    }
  }

  const dto: SummaryDto = {
    ...summary,
    legs: summary.legs.map((leg) => ({
      ...leg,
      fetchedAt: leg.fetchedAt.toISOString(),
    })),
    estimatesFetchedAt: summary.estimatesFetchedAt?.toISOString() ?? null,
    estimateAgeDays: estimateAgeDays(summary.estimatesFetchedAt, now),
  };

  return (
    <ReadOnlyTrip
      title={trip.title}
      stops={stops.map(
        (stop): StopDto => ({
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
        }),
      )}
      summary={dto}
      partial={partial}
    />
  );
}
