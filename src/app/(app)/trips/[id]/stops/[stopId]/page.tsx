import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSessionContext } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { getOwnedTrip, listStops } from '@/lib/trips/repository';
import { uuidSchema } from '@/lib/validation/schemas';
import { formatCoordinates } from '@/lib/coords';
import { formatNights } from '@/lib/format';
import TripMap from '@/components/TripMap';
import DestinationSection from '@/components/DestinationSection';

export const dynamic = 'force-dynamic';

/**
 * Full-screen detail view for one stop.
 *
 * Shell only: the sections below are deliberately empty and say so. Nothing
 * here reads from a table that does not exist yet, so this page needs no schema
 * change — it renders fields `stops` already has.
 *
 * Ownership is checked exactly as the editor does. A stop is reachable only
 * through a trip the current session or user owns; there is no lookup by stop
 * id alone, so a guessed stop id leads nowhere.
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

  const previous = stops[index - 1];
  const next = stops[index + 1];

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-line bg-white/85 px-5 py-3 backdrop-blur">
        <Link
          href={`/trips/${id}`}
          className="shrink-0 rounded-control border border-line px-2.5 py-1.5 text-sm hover:bg-inset"
        >
          ← Back to trip
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold">{stop.name}</h1>
          <p className="truncate text-xs text-ink-muted">
            Stop {index + 1} of {stops.length} · {trip.title}
          </p>
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-5 py-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <div className="flex flex-col gap-6">
            {/* What we already know about this stop. */}
            <section className="rounded-card border border-line p-4">
              <h2 className="text-sm font-semibold">Overview</h2>
              <dl className="mt-3 grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-ink-muted">
                    Coordinates
                  </dt>
                  <dd className="font-mono text-sm">
                    {formatCoordinates(stop.lat, stop.lng)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-ink-muted">
                    Nights
                  </dt>
                  <dd className="text-sm">{formatNights(stop.days)}</dd>
                </div>
                {stop.address ? (
                  <div className="sm:col-span-2">
                    <dt className="text-[11px] uppercase tracking-wide text-ink-muted">
                      Address
                    </dt>
                    <dd className="text-sm">{stop.address}</dd>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-ink-muted">
                    Notes
                  </dt>
                  <dd className="whitespace-pre-wrap text-sm">
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

            <DestinationSection
              title="Things to do"
              hint="Activities you have saved for this stop will appear here."
            />
            <DestinationSection
              title="Attractions"
              hint="Points of interest near this stop."
            />
            <DestinationSection
              title="Trails"
              hint="Walking and hiking routes starting near this stop."
            />
            <DestinationSection
              title="Restaurants"
              hint="Places to eat near this stop."
            />
            <DestinationSection
              title="Accommodation"
              hint="Hotels and hostels near this stop."
              /*
               * Booking and tour results will be supplied by partners, so the
               * slot carries the disclosure from the start. Declaring it now
               * means the layout never has to be rearranged to make room for
               * the label that regulators and the partner terms both require.
               */
              partnerSlot="Booking results will appear here."
            />
            <DestinationSection
              title="Tours and experiences"
              hint="Bookable activities near this stop."
              partnerSlot="Tour results will appear here."
            />
          </div>

          <aside className="flex flex-col gap-6">
            <section className="overflow-hidden rounded-card border border-line">
              <h2 className="border-b border-line px-4 py-2.5 text-sm font-semibold">
                Location
              </h2>
              {/*
                The same map component as the editor, given a single stop and no
                route. Markers are fixed here because no `onStopMoved` is
                passed — this is a reference view, not an editing surface.
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

            <DestinationSection
              title="Itinerary"
              hint="A day-by-day plan for this stop will be built here."
            />

            <nav className="flex items-center justify-between gap-2 text-sm">
              {previous ? (
                <Link
                  href={`/trips/${id}/stops/${previous.id}`}
                  className="min-w-0 truncate rounded-control border border-line px-2.5 py-1.5 hover:bg-inset"
                >
                  ← {previous.name}
                </Link>
              ) : (
                <span />
              )}
              {next ? (
                <Link
                  href={`/trips/${id}/stops/${next.id}`}
                  className="min-w-0 truncate rounded-control border border-line px-2.5 py-1.5 hover:bg-inset"
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
