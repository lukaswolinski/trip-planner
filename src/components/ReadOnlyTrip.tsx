import {
  ESTIMATE_TOOLTIP,
  formatDistance,
  formatEstimate,
  formatEstimateAge,
  formatNights,
  formatStopCount,
} from '@/lib/format';
import TripMap from './TripMap';
import type { StopDto, SummaryDto } from '@/types';

interface Props {
  title: string;
  stops: StopDto[];
  summary: SummaryDto;
  /** True when figures could not be recalculated on this view. */
  partial: boolean;
}

/**
 * The public share view.
 *
 * A Server Component with no editor bundle and no mutation surface — the only
 * client JavaScript is the map. There is deliberately no code path anywhere in
 * the app that writes to a trip identified by its share slug.
 */
export default function ReadOnlyTrip({ title, stops, summary, partial }: Props) {
  const age = formatEstimateAge(summary.estimateAgeDays);
  const legByFrom = new Map(summary.legs.map((leg) => [leg.fromStopId, leg]));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4">
      <header>
        <p className="text-xs uppercase tracking-wide text-ink-muted">
          Shared itinerary · view only
        </p>
        <h1 className="text-2xl font-semibold">{title}</h1>
      </header>

      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 rounded-control border border-line bg-inset px-4 py-3 text-sm">
        <span>
          <strong className="tabular-nums">
            {formatDistance(summary.totalDistanceM)}
          </strong>{' '}
          total
        </span>
        <span title={ESTIMATE_TOOLTIP}>
          <strong className="tabular-nums">{formatEstimate(summary.totalDurationS)}</strong>{' '}
          travelling
        </span>
        <span>{formatStopCount(summary.stopCount)}</span>
        <span>{formatNights(summary.totalNights)}</span>
        {age ? (
          <span className="ml-auto text-xs text-ink-muted">{age}</span>
        ) : null}
      </div>

      {partial ? (
        <p className="rounded-control border border-warn-line bg-warn-soft px-3 py-2 text-xs text-ink">
          Some distances are still being recalculated, so the totals above cover only
          part of the route. Reload in a moment for the full figures.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,24rem)_1fr]">
        <ol className="space-y-0">
          {stops.map((stop, index) => {
            const leg = legByFrom.get(stop.id);
            return (
              <li key={stop.id}>
                <div className="rounded-control border border-line bg-surface p-3">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-ink">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{stop.name}</p>
                      {stop.address ? (
                        <p className="truncate text-xs text-ink-muted">
                          {stop.address}
                        </p>
                      ) : null}
                      {stop.days > 0 ? (
                        <p className="mt-1 text-xs text-ink-muted">
                          {formatNights(stop.days)} here
                        </p>
                      ) : null}
                      {/*
                        Notes render as a text node — React escapes it, so no
                        dangerouslySetInnerHTML and no injection surface.
                      */}
                      {stop.notes ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-ink-muted">
                          {stop.notes}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {index < stops.length - 1 ? (
                  <div className="flex items-center gap-2 py-1 pl-6 text-xs text-ink-muted">
                    <span aria-hidden className="text-black/25">
                      │
                    </span>
                    {leg ? (
                      <span>
                        {leg.profile === 'walking' ? 'Walk' : 'Drive'}{' '}
                        {formatDistance(leg.distanceM)} ·{' '}
                        <span title={ESTIMATE_TOOLTIP}>
                          {formatEstimate(leg.durationS)}
                        </span>
                      </span>
                    ) : (
                      <span className="italic opacity-60">not yet calculated</span>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        <TripMap
          stops={stops.map((s) => ({ id: s.id, name: s.name, lat: s.lat, lng: s.lng }))}
          roadSegments={summary.roadSegments}
          flightSegments={summary.flightSegments}
          className="h-[26rem] w-full rounded-control lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)]"
        />
      </div>
    </div>
  );
}
