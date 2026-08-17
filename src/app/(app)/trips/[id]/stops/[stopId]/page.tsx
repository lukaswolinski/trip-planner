import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { getOwnedTrip, listStops } from '@/lib/trips/repository';
import { listItinerary } from '@/lib/trips/itinerary';
import { uuidSchema } from '@/lib/validation/schemas';
import { ESTIMATE_TOOLTIP, formatDistance, formatEstimate, formatNights } from '@/lib/format';
import { buildTripSummary, nullRouter } from '@/lib/routing/summary';
import { toSummaryStops } from '@/lib/routing/service';
import { createDbLegCache } from '@/lib/routing/cache';
import TripMap from '@/components/TripMap';
import ItineraryPanel from '@/components/ItineraryPanel';
import { microLabel } from '@/components/ui';
import type { ItineraryItemDto } from '@/types';

export const dynamic = 'force-dynamic';

/**
 * Full-screen detail view for one stop.
 *
 * Ownership is checked exactly as the editor does: a stop is only reachable
 * through a trip the current session or user owns, and there is no lookup by
 * stop id alone, so a guessed id leads nowhere.
 */
export default async function DestinationPage({
  params,
}: PageProps<'/trips/[id]/stops/[stopId]'>) {
  const { id, stopId } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  if (!uuidSchema.safeParse(stopId).success) notFound();

  const db = getDb();
  const context = await getSessionContext();

  const trip = await getOwnedTrip(db, id, context);
  if (!trip) notFound();

  const stops = await listStops(db, id);
  const index = stops.findIndex((s) => s.id === stopId);
  if (index === -1) notFound();
  const stop = stops[index];

  const items = await listItinerary(db, stopId);
  const itemDtos: ItineraryItemDto[] = items.map((item) => ({
    ...item,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  }));

  const previous = stops[index - 1];
  const next = stops[index + 1];

  /*
   * The leg you arrived on, read from the cache ONLY.
   *
   * `nullRouter` plus `allowMissingLegs` means this page never triggers a
   * provider request: opening a stop's detail view should not spend a routing
   * call or make the page wait on one. If the figure has not been computed yet
   * the trip page will compute it, and this simply says so.
   */
  let arrival: { distanceM: number; durationS: number; isFlight: boolean } | null = null;
  if (previous) {
    try {
      const cached = await buildTripSummary(
        toSummaryStops(stops),
        (trip.defaultProfile as 'driving' | 'walking') ?? 'driving',
        {
          cache: createDbLegCache(db),
          router: nullRouter,
          allowMissingLegs: true,
        },
      );
      const leg = cached.legs.find((l) => l.toStopId === stop.id);
      if (leg) {
        arrival = {
          distanceM: leg.distanceM,
          durationS: leg.durationS,
          isFlight: leg.isFlight,
        };
      }
    } catch (error) {
      // A missing figure must not take the page down.
      console.error('[page] destination arrival leg', error);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-bg">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-line bg-surface/85 px-5 py-3 backdrop-blur">
        <Link
          href={`/trips/${id}`}
          className="shrink-0 rounded-control border border-line bg-surface px-2.5 py-1.5 text-sm text-ink transition-colors hover:bg-inset"
        >
          ← Back to trip
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{stop.name}</h1>
          <p className="truncate text-[13px] text-ink-muted">
            Stop {index + 1} of {stops.length} · {trip.title}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-5 py-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_23rem]">
          <div className="flex flex-col gap-5">
            <section className="rounded-card border border-line bg-surface p-4">
              <h2 className="text-[15px] font-semibold">Overview</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                {/*
                  Coordinates and the raw address are gone: they are how the app
                  finds the place, not anything you need while planning. The
                  journey in is what you actually want to know on arrival.
                */}
                {previous ? (
                  <div>
                    <dt className={microLabel}>
                      {arrival?.isFlight ? 'Flight from' : 'Travel from'}{' '}
                      {previous.name}
                    </dt>
                    <dd className="tnum mt-0.5 text-sm">
                      {arrival === null ? (
                        <span className="text-ink-faint">Not calculated yet</span>
                      ) : arrival.isFlight ? (
                        // No duration for a flight: we know the distance exactly
                        // and the travel time not at all.
                        <>{formatDistance(arrival.distanceM)} direct · no drive time</>
                      ) : (
                        <>
                          {formatDistance(arrival.distanceM)}
                          <span className="px-1 text-ink-faint">·</span>
                          <span title={ESTIMATE_TOOLTIP}>
                            {formatEstimate(arrival.durationS)}
                          </span>
                        </>
                      )}
                    </dd>
                  </div>
                ) : (
                  <div>
                    <dt className={microLabel}>Position</dt>
                    <dd className="mt-0.5 text-sm">First stop of the trip</dd>
                  </div>
                )}
                <div>
                  <dt className={microLabel}>Nights</dt>
                  <dd className="mt-0.5 text-sm">{formatNights(stop.days)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className={microLabel}>Notes</dt>
                  <dd className="mt-0.5 whitespace-pre-wrap text-sm">
                    {stop.notes?.trim() ? (
                      stop.notes
                    ) : (
                      <span className="text-ink-faint">
                        No notes yet — add them on the trip page.
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
            </section>

            {/*
              Accommodation, activities, restaurants and trails are gone until
              they have something to show.

              Four "coming soon" boxes on every stop made a working app look
              broken, and they were actively misleading at a remote trailhead
              where there genuinely are no hotels or restaurants nearby — an
              empty section there is a fact about the place, not a fact about
              the app. When a data source is wired up, each section renders only
              if that source returns results for these coordinates.
            */}
            <ItineraryPanel tripId={id} stopId={stopId} initialItems={itemDtos} />
          </div>

          <aside className="flex flex-col gap-5 lg:sticky lg:top-20 lg:self-start">
            <section className="overflow-hidden rounded-card border border-line bg-surface">
              <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">
                Location
              </h2>
              {/*
                The editor's map component with a single stop and no route.
                Markers are fixed here because no `onStopMoved` is passed — this
                is a reference view, not an editing surface.
              */}
              <div className="h-72">
                <TripMap
                  stops={[
                    { id: stop.id, name: stop.name, lat: stop.lat, lng: stop.lng },
                  ]}
                  roadSegments={[]}
                  flightSegments={[]}
                  className="h-full w-full"
                />
              </div>
            </section>

            <nav className="flex items-center justify-between gap-2 text-[13px]">
              {previous ? (
                <Link
                  href={`/trips/${id}/stops/${previous.id}`}
                  className="min-w-0 truncate rounded-control border border-line bg-surface px-2.5 py-1.5 text-ink-muted transition-colors hover:bg-inset hover:text-ink"
                >
                  ← {previous.name}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`/trips/${id}/stops/${next.id}`}
                  className="min-w-0 truncate rounded-control border border-line bg-surface px-2.5 py-1.5 text-ink-muted transition-colors hover:bg-inset hover:text-ink"
                >
                  {next.name} →
                </Link>
              ) : (
                <span />
              )}
            </nav>
          </aside>
        </div>
      </div>
    </div>
  );
}
