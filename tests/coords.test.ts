import { describe, expect, it } from 'vitest';
import { formatCoordinates, parseCoordinateInput } from '@/lib/coords';

describe('recognising coordinate pairs', () => {
  it('accepts the common comma-separated form', () => {
    expect(parseCoordinateInput('38.574, -109.546')).toEqual({
      lat: 38.574,
      lng: -109.546,
      swapped: false,
    });
  });

  it('accepts space separation and no separator whitespace', () => {
    expect(parseCoordinateInput('38.574 -109.546')?.lat).toBe(38.574);
    expect(parseCoordinateInput('38.574,-109.546')?.lng).toBe(-109.546);
  });

  it('tolerates surrounding whitespace and parentheses', () => {
    expect(parseCoordinateInput('   38.574 , -109.546  ')?.lat).toBe(38.574);
    expect(parseCoordinateInput('(38.574, -109.546)')?.lng).toBe(-109.546);
  });

  it('handles degree signs and hemisphere letters', () => {
    expect(parseCoordinateInput('38.574° N, 109.546° W')).toEqual({
      lat: 38.574,
      lng: -109.546,
      swapped: false,
    });
    expect(parseCoordinateInput('38.574N 109.546W')?.lng).toBe(-109.546);
    expect(parseCoordinateInput('33.87S, 151.21E')).toEqual({
      lat: -33.87,
      lng: 151.21,
      swapped: false,
    });
  });

  it('accepts both hemispheres and the origin', () => {
    expect(parseCoordinateInput('-33.8688, 151.2093')?.lat).toBeCloseTo(-33.8688, 6);
    expect(parseCoordinateInput('0.0, 0.0')).toEqual({ lat: 0, lng: 0, swapped: false });
  });

  it('accepts the exact range boundaries', () => {
    expect(parseCoordinateInput('90.0, 180.0')?.lat).toBe(90);
    expect(parseCoordinateInput('-90.0, -180.0')?.lng).toBe(-180);
  });
});

describe('rejecting things that are not coordinates', () => {
  it('rejects pairs that are out of range in BOTH orders', () => {
    expect(parseCoordinateInput('10.0, 181.0')).toBeNull(); // 181 is no valid axis
    expect(parseCoordinateInput('91.0, 95.0')).toBeNull(); // neither can be a latitude
    expect(parseCoordinateInput('200.0, 300.0')).toBeNull();
  });

  it('offers the swapped reading when only one order is in range', () => {
    /*
     * Not silent guessing: the parser feeds a suggestion row that the user has
     * to click, and the UI labels a swapped reading explicitly. Offering the
     * only valid interpretation is what makes pasting GeoJSON order work; the
     * user can see the resulting numbers before accepting them.
     */
    expect(parseCoordinateInput('91.0, 10.0')).toEqual({
      lat: 10,
      lng: 91,
      swapped: true,
    });
    expect(parseCoordinateInput('-90.5, 0.0')).toEqual({
      lat: 0,
      lng: -90.5,
      swapped: true,
    });
  });

  it('rejects place names, including ones with numbers', () => {
    expect(parseCoordinateInput('Moab')).toBeNull();
    expect(parseCoordinateInput('Moab, Utah')).toBeNull();
    expect(parseCoordinateInput('38 Main Street')).toBeNull();
    expect(parseCoordinateInput('Bend 97701')).toBeNull();
    expect(parseCoordinateInput('Highway 191')).toBeNull();
  });

  it('rejects bare integer pairs, which are usually not coordinates', () => {
    // "12 30" is far more likely a street number or a search phrase. Requiring a
    // decimal keeps ordinary searches out of the coordinate path.
    expect(parseCoordinateInput('12 30')).toBeNull();
    expect(parseCoordinateInput('38, -109')).toBeNull();
  });

  it('rejects the wrong number of values', () => {
    expect(parseCoordinateInput('38.574')).toBeNull();
    expect(parseCoordinateInput('38.574, -109.546, 1200.0')).toBeNull();
    expect(parseCoordinateInput('')).toBeNull();
    expect(parseCoordinateInput('   ')).toBeNull();
  });

  it('rejects contradictory or malformed signs', () => {
    expect(parseCoordinateInput('N38.574S, -109.546')).toBeNull();
    expect(parseCoordinateInput('-38.574N, 109.546')).toBeNull();
    expect(parseCoordinateInput('38..574, -109.546')).toBeNull();
    expect(parseCoordinateInput('abc.def, 1.0')).toBeNull();
  });
});

describe('lat/lng order', () => {
  it('prefers lat,lng when both readings are valid', () => {
    // 38.5 and 40.2 are both valid latitudes, so no guessing: take them in order.
    expect(parseCoordinateInput('38.5, 40.2')).toEqual({
      lat: 38.5,
      lng: 40.2,
      swapped: false,
    });
  });

  it('falls back to lng,lat only when lat,lng is impossible', () => {
    // GeoJSON order. -109.5 cannot be a latitude, so the intent is unambiguous.
    expect(parseCoordinateInput('-109.546, 38.574')).toEqual({
      lat: 38.574,
      lng: -109.546,
      swapped: true,
    });
  });

  it('flags the swap so the UI can say what it assumed', () => {
    expect(parseCoordinateInput('-109.546, 38.574')?.swapped).toBe(true);
    expect(parseCoordinateInput('38.574, -109.546')?.swapped).toBe(false);
  });
});

describe('formatting', () => {
  it('uses 5 decimal places, matching the routing cache precision', () => {
    expect(formatCoordinates(38.5733, -109.5498)).toBe('38.57330, -109.54980');
    expect(formatCoordinates(0, 0)).toBe('0.00000, 0.00000');
  });

  it('round-trips through the parser', () => {
    const formatted = formatCoordinates(38.5733, -109.5498);
    expect(parseCoordinateInput(formatted)).toEqual({
      lat: 38.5733,
      lng: -109.5498,
      swapped: false,
    });
  });
});
