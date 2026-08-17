'use client';

import { resolve12Hour, useTimePreference } from '@/lib/client/time-format';

interface Props {
  /** Minutes from midnight, or null for no time. */
  value: number | null;
  onChange: (value: number | null) => void;
  /** Used to build the accessible names, e.g. "Hour for Ride the tram". */
  label: string;
  className?: string;
}

/** Five-minute granularity: fine enough to plan a day, short enough to scan. */
const MINUTE_STEP = 5;
const MINUTES = Array.from({ length: 60 / MINUTE_STEP }, (_, i) => i * MINUTE_STEP);

/**
 * A time chosen from lists, never typed.
 *
 * Replaces a free-text field that accepted anything and quietly discarded what
 * it could not parse — "half nine", "9pm" and "25:00" all silently became no
 * time at all. Selects make an invalid time unrepresentable rather than
 * rejected after the fact, which is the difference between a rule the user has
 * to learn and one they cannot break.
 *
 * `<input type="time">` was the other candidate. It is excellent, but its 12 vs
 * 24-hour display is dictated by the browser locale with no way to override it,
 * and an override was wanted here.
 */
export default function TimePicker({ value, onChange, label, className }: Props) {
  const preference = useTimePreference();
  const use12Hour = resolve12Hour(preference);

  const hour24 = value === null ? null : Math.floor(value / 60);
  const minute = value === null ? null : value % 60;

  // Snap a stored time that predates the step (or came from elsewhere) to the
  // nearest option, so the select still shows the right thing.
  const shownMinute =
    minute === null ? null : MINUTES.reduce((best, m) =>
      Math.abs(m - minute) < Math.abs(best - minute) ? m : best,
    );

  const isPm = hour24 !== null && hour24 >= 12;
  const hour12 = hour24 === null ? null : hour24 % 12 === 0 ? 12 : hour24 % 12;

  function emit(nextHour24: number | null, nextMinute: number | null) {
    if (nextHour24 === null) {
      onChange(null);
      return;
    }
    onChange(nextHour24 * 60 + (nextMinute ?? 0));
  }

  const select =
    'rounded-control border border-line bg-surface px-1.5 py-1 text-[13px] text-ink ' +
    'transition-colors hover:border-line-strong focus:border-accent focus:outline-none ' +
    'focus:ring-2 focus:ring-accent/20';

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      <select
        aria-label={`Hour for ${label}`}
        className={`${select} tnum`}
        value={hour24 === null ? '' : use12Hour ? String(hour12) : String(hour24)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') {
            emit(null, null);
            return;
          }
          const picked = Number(raw);
          const next = use12Hour
            ? (picked % 12) + (isPm ? 12 : 0)
            : picked;
          emit(next, shownMinute ?? 0);
        }}
      >
        {/* The empty option is how a time is cleared — no separate control. */}
        <option value="">--</option>
        {(use12Hour
          ? Array.from({ length: 12 }, (_, i) => i + 1)
          : Array.from({ length: 24 }, (_, i) => i)
        ).map((h) => (
          <option key={h} value={h}>
            {use12Hour ? h : String(h).padStart(2, '0')}
          </option>
        ))}
      </select>

      <span aria-hidden className="text-ink-faint">
        :
      </span>

      <select
        aria-label={`Minute for ${label}`}
        className={`${select} tnum`}
        value={shownMinute === null ? '' : String(shownMinute)}
        disabled={hour24 === null}
        onChange={(event) => emit(hour24, Number(event.target.value))}
      >
        {shownMinute === null ? <option value="">--</option> : null}
        {MINUTES.map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, '0')}
          </option>
        ))}
      </select>

      {use12Hour ? (
        <select
          aria-label={`AM or PM for ${label}`}
          className={select}
          value={isPm ? 'pm' : 'am'}
          disabled={hour24 === null}
          onChange={(event) => {
            if (hour24 === null) return;
            const base = hour24 % 12;
            emit(event.target.value === 'pm' ? base + 12 : base, shownMinute ?? 0);
          }}
        >
          <option value="am">AM</option>
          <option value="pm">PM</option>
        </select>
      ) : null}
    </div>
  );
}
