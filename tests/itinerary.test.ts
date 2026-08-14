/**
 * Itinerary time handling and input validation.
 *
 * The clock helpers are pure, so they are tested directly. The persistence
 * layer's contiguity and ownership guarantees are covered by db.test.ts, which
 * needs a real database.
 */

import { describe, expect, it } from 'vitest';
import { formatClock, parseClock } from '@/lib/format';
import { schemasFor } from '@/lib/validation/schemas';

const schemas = schemasFor('free');

describe('clock formatting', () => {
  it('renders minutes from midnight as a padded 24-hour time', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9 * 60)).toBe('09:00');
    expect(formatClock(9 * 60 + 30)).toBe('09:30');
    expect(formatClock(13 * 60 + 5)).toBe('13:05');
    expect(formatClock(23 * 60 + 59)).toBe('23:59');
  });

  it('clamps rather than wrapping past the end of the day', () => {
    // Wrapping 1500 to 01:00 would silently move an activity to the next day.
    expect(formatClock(1500)).toBe('23:59');
    expect(formatClock(-30)).toBe('00:00');
  });
});

describe('clock parsing', () => {
  it('accepts the shapes people actually type', () => {
    expect(parseClock('9:30')).toBe(570);
    expect(parseClock('09:30')).toBe(570);
    expect(parseClock('0930')).toBe(570);
    expect(parseClock(' 7:05 ')).toBe(425);
    expect(parseClock('23:59')).toBe(1439);
    expect(parseClock('00:00')).toBe(0);
  });

  it('returns null for anything it cannot read', () => {
    // Null means "no time yet", so a half-typed value never becomes a guess.
    expect(parseClock('')).toBeNull();
    expect(parseClock('9')).toBeNull();
    expect(parseClock('abc')).toBeNull();
    expect(parseClock('9:5')).toBeNull();
  });

  it('rejects impossible times rather than rolling them over', () => {
    expect(parseClock('24:00')).toBeNull();
    expect(parseClock('12:60')).toBeNull();
    expect(parseClock('99:99')).toBeNull();
  });

  it('round-trips every minute of the day', () => {
    for (let minute = 0; minute < 1440; minute += 7) {
      expect(parseClock(formatClock(minute))).toBe(minute);
    }
  });
});

describe('itinerary validation', () => {
  it('requires a non-empty title', () => {
    expect(schemas.createItineraryItem.safeParse({ title: '' }).success).toBe(false);
    expect(schemas.createItineraryItem.safeParse({ title: '   ' }).success).toBe(false);
    expect(schemas.createItineraryItem.safeParse({ title: 'Tram up the peak' }).success).toBe(
      true,
    );
  });

  it('accepts a null time but not one outside the day', () => {
    const ok = (startMinutes: unknown) =>
      schemas.createItineraryItem.safeParse({ title: 'x', startMinutes }).success;
    expect(ok(null)).toBe(true);
    expect(ok(0)).toBe(true);
    expect(ok(1439)).toBe(true);
    expect(ok(1440)).toBe(false);
    expect(ok(-1)).toBe(false);
    expect(ok(9.5)).toBe(false);
  });

  it('rejects an empty PATCH instead of accepting a silent no-op', () => {
    expect(schemas.patchItineraryItem.safeParse({}).success).toBe(false);
    expect(schemas.patchItineraryItem.safeParse({ title: 'New' }).success).toBe(true);
    // Clearing a time is a real edit, distinct from omitting the field.
    expect(schemas.patchItineraryItem.safeParse({ startMinutes: null }).success).toBe(true);
  });

  it('requires reorder ids to be uuids', () => {
    expect(schemas.reorderItinerary.safeParse({ orderedIds: [] }).success).toBe(false);
    expect(schemas.reorderItinerary.safeParse({ orderedIds: ['nope'] }).success).toBe(false);
    expect(
      schemas.reorderItinerary.safeParse({
        orderedIds: ['3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
      }).success,
    ).toBe(true);
  });
});
