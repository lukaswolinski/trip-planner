import {
  ESTIMATE_TOOLTIP,
  formatDistance,
  formatEstimate,
  formatEstimateAge,
  formatNights,
  formatStopCount,
} from '@/lib/format';
import { Skeleton, microLabel } from './ui';
import type { SummaryDto } from '@/types';

interface Props {
  summary: SummaryDto | null;
  unit: 'km' | 'mi';
  onToggleUnit?: () => void;
  stale?: boolean;
}

export default function TotalsBar({ summary, unit, onToggleUnit, stale }: Props) {
  const age = formatEstimateAge(summary?.estimateAgeDays ?? null);
  const hasFlights = (summary?.flightLegCount ?? 0) > 0;

  return (
    <div className="rounded-card border border-line bg-inset px-4 py-3">
      <div className="flex flex-wrap items-start gap-x-7 gap-y-3">
        {/*
          Labelled "Driving" only when a flight is present, so the wording stays
          plain on ordinary trips and becomes precise exactly when it matters.
        */}
        <Stat
          label={hasFlights ? 'Driving' : 'Distance'}
          value={summary ? formatDistance(summary.totalDistanceM, unit) : null}
          title={
            hasFlights
              ? 'Ground travel only. Flight legs are listed separately.'
              : undefined
          }
          stale={stale}
        />
        <Stat
          label="Travel time"
          value={summary ? formatEstimate(summary.totalDurationS) : null}
          title={ESTIMATE_TOOLTIP}
          stale={stale}
        />
        {hasFlights && summary ? (
          <Stat
            label={summary.flightLegCount === 1 ? 'Flight' : 'Flights'}
            value={`${summary.flightLegCount} · ${formatDistance(summary.totalFlightDistanceM, unit)}`}
            title="Legs with no road connection. Distance is straight-line; no travel time is included in the total."
            stale={stale}
          />
        ) : null}
        <Stat label="Stops" value={summary ? formatStopCount(summary.stopCount) : null} />
        <Stat
          label="Overnights"
          value={summary ? formatNights(summary.totalNights) : null}
        />

        <div className="ml-auto flex items-center gap-2.5 self-center">
          {age ? (
            <span
              className="text-[11px] text-ink-faint"
              title="Route estimates are refreshed at least every 30 days"
            >
              {age}
            </span>
          ) : null}
          {onToggleUnit ? (
            <button
              type="button"
              onClick={onToggleUnit}
              title={`Show distances in ${unit === 'km' ? 'miles' : 'kilometres'}`}
              className="rounded-control border border-line bg-surface px-2 py-1 text-[11px] font-medium text-ink-muted transition-colors hover:bg-inset hover:text-ink"
            >
              {unit === 'km' ? 'mi' : 'km'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  title,
  stale,
}: {
  label: string;
  /** Null renders a skeleton — the figure exists, it just has not arrived yet. */
  value: string | null;
  title?: string;
  stale?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className={microLabel}>{label}</div>
      {value === null ? (
        <Skeleton className="mt-1 h-4 w-20" />
      ) : (
        <div
          className={`tnum mt-0.5 text-[15px] font-semibold text-ink ${stale ? 'opacity-50' : ''}`}
          title={title}
        >
          {value}
        </div>
      )}
    </div>
  );
}
