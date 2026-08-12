/**
 * Display formatting.
 *
 * Durations always carry an "approximately" marker. That is accuracy, not
 * hedging: we route with Mapbox's `driving` profile rather than
 * `driving-traffic`, because traffic-aware timings describe conditions right now
 * and a road trip is planned weeks ahead. The number is a typical-conditions
 * estimate, so the UI says so.
 */

export type DistanceUnit = 'km' | 'mi';

const MILES_PER_METRE = 0.000621371;

export function formatDistance(metres: number, unit: DistanceUnit = 'km'): string {
  if (unit === 'mi') {
    const miles = metres * MILES_PER_METRE;
    return `${format1(miles)} mi`;
  }
  return `${format1(metres / 1000)} km`;
}

function format1(value: number): string {
  if (value < 10) return value.toFixed(1);
  return Math.round(value).toLocaleString();
}

/** "6 h 12 min", "48 min", "3 d 4 h" for genuinely long legs. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours < 24) {
    return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
  }

  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours === 0 ? `${days} d` : `${days} d ${restHours} h`;
}

/** Durations shown to users always get the estimate marker. */
export function formatEstimate(seconds: number): string {
  return `≈ ${formatDuration(seconds)}`;
}

export const ESTIMATE_TOOLTIP =
  'Estimated travel time in typical conditions — not live traffic';

/** "updated today", "updated 3 days ago". */
export function formatEstimateAge(days: number | null): string | null {
  if (days === null) return null;
  if (days === 0) return 'Estimates updated today';
  if (days === 1) return 'Estimates updated yesterday';
  return `Estimates updated ${days} days ago`;
}

export function formatNights(nights: number): string {
  if (nights === 0) return 'no overnight stops';
  return nights === 1 ? '1 night' : `${nights} nights`;
}

export function formatStopCount(count: number): string {
  return count === 1 ? '1 stop' : `${count} stops`;
}
