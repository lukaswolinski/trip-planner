import { describe, expect, it } from 'vitest';
import {
  decodePolyline,
  encodePolyline,
  joinPointSequences,
  stitchEncoded,
  type LngLat,
} from '@/lib/polyline';

describe('polyline codec', () => {
  it('round-trips coordinates at 6dp precision', () => {
    const points: LngLat[] = [
      [-104.98470, 39.73915],
      [-105.20000, 39.90000],
      [-109.54980, 38.57330],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    expect(decoded).toHaveLength(points.length);
    decoded.forEach(([lng, lat], i) => {
      expect(lng).toBeCloseTo(points[i][0], 6);
      expect(lat).toBeCloseTo(points[i][1], 6);
    });
  });

  it('returns [lng, lat] in GeoJSON order, not the wire order', () => {
    // Encoded latitude-first, decoded longitude-first. Getting this backwards
    // puts the route in the ocean.
    const [point] = decodePolyline(encodePolyline([[-104.9847, 39.73915]]));
    expect(point[0]).toBeCloseTo(-104.9847, 6);
    expect(point[1]).toBeCloseTo(39.73915, 6);
  });

  it('handles an empty string and empty input', () => {
    expect(decodePolyline('')).toEqual([]);
    expect(encodePolyline([])).toBe('');
  });

  it('survives southern and western hemispheres', () => {
    const points: LngLat[] = [
      [-70.6693, -33.4489],
      [-58.3816, -34.6037],
    ];
    const decoded = decodePolyline(encodePolyline(points));
    decoded.forEach(([lng, lat], i) => {
      expect(lng).toBeCloseTo(points[i][0], 6);
      expect(lat).toBeCloseTo(points[i][1], 6);
    });
  });
});

describe('stitching', () => {
  it('drops the duplicated seam point between sequences', () => {
    const a: LngLat[] = [
      [0, 0],
      [1, 1],
    ];
    const b: LngLat[] = [
      [1, 1],
      [2, 2],
    ];
    expect(joinPointSequences([a, b])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
  });

  it('keeps both points when sequences do not actually meet', () => {
    const a: LngLat[] = [
      [0, 0],
      [1, 1],
    ];
    const b: LngLat[] = [
      [5, 5],
      [6, 6],
    ];
    expect(joinPointSequences([a, b])).toHaveLength(4);
  });

  it('skips empty sequences', () => {
    expect(
      joinPointSequences([[], [[1, 1]], [], [[2, 2]]]),
    ).toEqual([
      [1, 1],
      [2, 2],
    ]);
  });

  it('stitches encoded legs into one line', () => {
    const leg1 = encodePolyline([
      [0, 0],
      [1, 1],
    ]);
    const leg2 = encodePolyline([
      [1, 1],
      [2, 2],
    ]);
    expect(stitchEncoded([leg1, leg2])).toHaveLength(3);
  });
});
