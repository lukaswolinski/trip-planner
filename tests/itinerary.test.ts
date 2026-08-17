/**
 * Itinerary time handling and input validation.
 *
 * There is no longer any clock *parsing* to test: the time picker offers hours
 * and minutes as lists, so an invalid time cannot be expressed rather than
 * being rejected after the fact. What remains worth testing is which clock
 * format gets chosen, and that the API still refuses an impossible value if one
 * ever arrives from somewhere other than the UI.
 */

import { describe, expect, it } from 'vitest';
import { resolve12Hour } from '@/lib/client/time-format';
import { schemasFor } from '@/lib/validation/schemas';

const schemas = schemasFor('free');

describe('time format preference', () => {
  it('honours an explicit choice regardless of locale', () => {
    expect(resolve12Hour('12')).toBe(true);
    expect(resolve12Hour('24')).toBe(false);
  });

  it('falls back to the locale when set to automatic', () => {
    // The value depends on the environment's locale, so assert only that it
    // produces a definite answer rather than throwing or returning undefined.
    expect(typeof resolve12Hour('auto')).toBe('boolean');
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
