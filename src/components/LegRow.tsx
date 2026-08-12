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
        <span className={stale ? 'opacity-50' : undefined}>
          {leg.profile === 'walking' ? 'Walk' : 'Drive'} {formatDistance(leg.distanceM, unit)}
          {' · '}
          <span title={ESTIMATE_TOOLTIP}>{formatEstimate(leg.durationS)}</span>
        </span>
      ) : (
        <span className="italic opacity-60">calculating…</span>
      )}
    </div>
  );
}
