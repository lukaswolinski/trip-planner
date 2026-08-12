import { describe, expect, it } from 'vitest';
import { schemasFor } from '@/lib/validation/schemas';
import { getLimits } from '@/lib/limits';

const schemas = schemasFor('free');
const limits = getLimits('free');

describe('stop validation', () => {
  const valid = { name: 'Moab', lat: 38.5733, lng: -109.5498 };

  it('accepts a well-formed stop', () => {
    expect(schemas.createStop.safeParse(valid).success).toBe(true);
  });

  it('rejects out-of-range coordinates', () => {
    expect(schemas.createStop.safeParse({ ...valid, lat: 91 }).success).toBe(false);
    expect(schemas.createStop.safeParse({ ...valid, lat: -91 }).success).toBe(false);
    expect(schemas.createStop.safeParse({ ...valid, lng: 181 }).success).toBe(false);
    expect(schemas.createStop.safeParse({ ...valid, lng: -181 }).success).toBe(false);
  });

  it('rejects NaN and Infinity coordinates', () => {
    expect(schemas.createStop.safeParse({ ...valid, lat: Number.NaN }).success).toBe(false);
    expect(
      schemas.createStop.safeParse({ ...valid, lng: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(schemas.createStop.safeParse({ ...valid, name: '' }).success).toBe(false);
    expect(schemas.createStop.safeParse({ ...valid, name: '   ' }).success).toBe(false);
  });

  it('strips NUL bytes, which Postgres text cannot store', () => {
    const nul = String.fromCharCode(0);
    const result = schemas.createStop.safeParse({
      ...valid,
      name: `Mo${nul}ab`,
      notes: `line${nul}one`,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe('Moab');
      expect(result.data.notes).toBe('lineone');
    }
  });

  it('strips newlines and escape sequences from single-line fields', () => {
    const esc = String.fromCharCode(27);
    const result = schemas.createStop.safeParse({
      ...valid,
      name: `Moab${String.fromCharCode(10)}${esc}[31mred`,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.name).toBe('Moab[31mred');
  });

  it('keeps newlines in notes but normalises CRLF', () => {
    const result = schemas.createStop.safeParse({
      ...valid,
      notes: 'first\r\nsecond\rthird\nfourth',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe('first\nsecond\nthird\nfourth');
    }
  });

  it('enforces the notes length cap', () => {
    const tooLong = 'x'.repeat(limits.maxNotesChars + 1);
    expect(schemas.createStop.safeParse({ ...valid, notes: tooLong }).success).toBe(false);
    const atLimit = 'x'.repeat(limits.maxNotesChars);
    expect(schemas.createStop.safeParse({ ...valid, notes: atLimit }).success).toBe(true);
  });

  it('rejects negative or fractional night counts', () => {
    expect(schemas.createStop.safeParse({ ...valid, days: -1 }).success).toBe(false);
    expect(schemas.createStop.safeParse({ ...valid, days: 1.5 }).success).toBe(false);
  });

  it('rejects an unknown travel profile', () => {
    expect(
      schemas.createStop.safeParse({ ...valid, profileToNext: 'teleport' }).success,
    ).toBe(false);
    expect(
      schemas.createStop.safeParse({ ...valid, profileToNext: 'walking' }).success,
    ).toBe(true);
  });

  it('requires at least one field on a patch', () => {
    expect(schemas.patchStop.safeParse({}).success).toBe(false);
    expect(schemas.patchStop.safeParse({ days: 2 }).success).toBe(true);
  });
});

describe('reorder validation', () => {
  it('requires uuids', () => {
    expect(schemas.reorder.safeParse({ stopIds: ['not-a-uuid'] }).success).toBe(false);
  });

  it('rejects an empty ordering', () => {
    expect(schemas.reorder.safeParse({ stopIds: [] }).success).toBe(false);
  });

  it('caps the array at the hard stop limit', () => {
    const id = '00000000-0000-4000-8000-000000000000';
    const overCap = Array.from({ length: limits.hardMaxStops + 1 }, () => id);
    expect(schemas.reorder.safeParse({ stopIds: overCap }).success).toBe(false);
  });
});

describe('trip validation', () => {
  it('requires a version for optimistic concurrency', () => {
    expect(schemas.patchTrip.safeParse({ title: 'Trip' }).success).toBe(false);
    expect(schemas.patchTrip.safeParse({ title: 'Trip', version: 0 }).success).toBe(true);
  });

  it('caps the title length', () => {
    const tooLong = 'x'.repeat(limits.maxTitleChars + 1);
    expect(schemas.patchTrip.safeParse({ title: tooLong, version: 0 }).success).toBe(false);
  });
});

describe('geocode and auth validation', () => {
  it('requires at least two characters to search', () => {
    expect(schemas.geocodeQuery.safeParse({ q: 'a' }).success).toBe(false);
    expect(schemas.geocodeQuery.safeParse({ q: 'ab' }).success).toBe(true);
  });

  it('lowercases and trims emails', () => {
    const result = schemas.authRequest.safeParse({ email: '  Person@Example.COM ' });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('person@example.com');
  });

  it('rejects malformed emails', () => {
    expect(schemas.authRequest.safeParse({ email: 'nope' }).success).toBe(false);
    expect(schemas.authRequest.safeParse({ email: 'a@b' }).success).toBe(false);
  });
});
