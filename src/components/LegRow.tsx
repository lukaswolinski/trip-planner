import { ESTIMATE_TOOLTIP, formatDistance, formatEstimate } from '@/lib/format';
import { Skeleton } from './ui';
import type { SummaryLegDto } from '@/types';

interface Props {
  leg: SummaryLegDto | undefined;
  unit: 'km' | 'mi';
  /** True while a recompute is in flight, so figures are shown as provisional. */
  stale: boolean;
}

/**
 * The distance and time between two consecutive stops.
 *
 * The connector sits at the same x-position as the numbered badges above and
 * below it, so the list reads as one continuous route rather than a stack of
 * unrelated cards.
 */
export default function LegRow({ leg, unit, stale }: Props) {
  return (
    <div className="flex items-center gap-3 py-1 pl-3.5">
      <div aria-hidden className="flex w-7 justify-center">
        <span className="h-7 w-px bg-line-strong" />
      </div>

      {leg ? (
        leg.isFlight ? (
          /*
           * No duration shown, because we genuinely do not know one — a flight
           * time depends on schedules and airports we have no data for. Showing
           * "0 min" or a guess would be worse than showing nothing.
           */
          <span
            className={`flex items-center gap-2 text-[13px] ${stale ? 'opacity-50' : ''}`}
            title="No road connects these stops, so this leg is shown as a flight. The distance is measured in a straight line and there is no drive time."
          >
            <span className="rounded-full bg-flight-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-flight">
              Flight
            </span>
            <span className="tnum text-ink-muted">
              {formatDistance(leg.distanceM, unit)} direct · no drive time
            </span>
          </span>
        ) : (
          <span className={`tnum text-[13px] text-ink-muted ${stale ? 'opacity-50' : ''}`}>
            {leg.profile === 'walking' ? 'Walk' : 'Drive'}{' '}
            {formatDistance(leg.distanceM, unit)}
            <span className="px-1 text-ink-faint">·</span>
            <span title={ESTIMATE_TOOLTIP}>{formatEstimate(leg.durationS)}</span>
          </span>
        )
      ) : (
        // The shape of the figure is known even while the value is not.
        <Skeleton className="h-3.5 w-32" />
      )}
    </div>
  );
}
