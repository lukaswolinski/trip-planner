import {
  ESTIMATE_TOOLTIP,
  formatDistance,
  formatEstimate,
  formatEstimateAge,
  formatNights,
  formatStopCount,
} from '@/lib/format';
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
    <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 rounded-lg border border-black/10 bg-black/[0.02] px-4 py-3 dark:border-white/15 dark:bg-white/[0.04]">
      {/*
        Labelled "Driving distance" only when a flight is present, so the
        wording stays plain on ordinary trips but becomes precise exactly when
        the distinction starts to matter.
      */}
      <Stat
        label={hasFlights ? 'Driving distance' : 'Total distance'}
        value={summary ? formatDistance(summary.totalDistanceM, unit) : '—'}
        title={
          hasFlights
            ? 'Ground travel only. Flight legs are listed separately.'
            : undefined
        }
        stale={stale}
      />
      <Stat
        label="Travel time"
        value={summary ? formatEstimate(summary.totalDurationS) : '—'}
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
      <Stat
        label="Stops"
        value={summary ? formatStopCount(summary.stopCount) : '—'}
      />
      <Stat
        label="Overnights"
        value={summary ? formatNights(summary.totalNights) : '—'}
      />

      <div className="ml-auto flex items-center gap-3">
        {age ? (
          <span
            className="text-xs text-black/45 dark:text-white/45"
            title="Route estimates are refreshed at least every 30 days"
          >
            {age}
          </span>
        ) : null}
        {onToggleUnit ? (
          <button
            type="button"
            onClick={onToggleUnit}
            className="rounded border border-black/15 px-2 py-0.5 text-xs hover:bg-black/5 dark:border-white/20 dark:hover:bg-white/10"
          >
            {unit === 'km' ? 'Switch to miles' : 'Switch to km'}
          </button>
        ) : null}
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
  value: string;
  title?: string;
  stale?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-black/45 dark:text-white/45">
        {label}
      </div>
      <div
        className={`text-sm font-semibold tabular-nums ${stale ? 'opacity-50' : ''}`}
        title={title}
      >
        {value}
      </div>
    </div>
  );
}
