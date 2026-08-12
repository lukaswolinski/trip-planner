import { ESTIMATE_TOOLTIP, formatDistance, formatEstimate } from '@/lib/format';
import type { SummaryLegDto } from '@/types';

interface Props {
  leg: SummaryLegDto | undefined;
  unit: 'km' | 'mi';
  /** True while a recompute is in flight, so figures are shown as provisional. */
  stale: boolean;
}

/** The distance and time between two consecutive stops. */
export default function LegRow({ leg, unit, stale }: Props) {
  return (
    <div className="flex items-center gap-2 py-1 pl-6 text-xs text-black/55 dark:text-white/55">
      <span aria-hidden className="text-black/25 dark:text-white/25">
        │
      </span>
      {leg ? (
        leg.isFlight ? (
          /*
           * No duration shown, because we genuinely do not know one — a flight
           * time depends on schedules and airports we have no data for. Showing
           * "0 min" or a guess would be worse than showing nothing.
           */
          <span
            className={`flex items-center gap-1.5 ${stale ? 'opacity-50' : ''}`}
            title="No road connects these stops, so this leg is shown as a flight. The distance is measured in a straight line and there is no drive time."
          >
            <span
              aria-hidden
              className="rounded-sm bg-orange-100 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-orange-700 dark:bg-orange-950/60 dark:text-orange-300"
            >
              Flight
            </span>
            <span>{formatDistance(leg.distanceM, unit)} direct · no drive time</span>
          </span>
        ) : (
          <span className={stale ? 'opacity-50' : undefined}>
            {leg.profile === 'walking' ? 'Walk' : 'Drive'} {formatDistance(leg.distanceM, unit)}
            {' · '}
            <span title={ESTIMATE_TOOLTIP}>{formatEstimate(leg.durationS)}</span>
          </span>
        )
      ) : (
        <span className="italic opacity-60">calculating…</span>
      )}
    </div>
  );
}
