/**
 * Great-circle distance, and the straight line drawn for flight legs.
 *
 * Pure and dependency-free like the rest of the routing core, so the
 * flight-leg behaviour is testable with no network and no database.
 */

/** IUGG mean Earth radius, in metres. */
export const EARTH_RADIUS_M = 6_371_008.8;

export interface Point {
  lat: number;
  lng: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * This is what a flight leg reports instead of a road distance. It is a real
 * measurement — the shortest distance over the Earth's surface — not a
 * placeholder, so labelling it "direct distance" in the UI is honest.
 */
export function haversineMeters(a: Point, b: Point): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Shifts a longitude into the ±180° window nearest a reference longitude.
 *
 * Without this, a Tokyo→Los Angeles flight leg (139° to −118°) draws a line
 * 257° *westward* across Asia, Europe and the Atlantic rather than the short
 * hop east across the Pacific. Returning −221° instead of 139° keeps the line
 * continuous, which is what MapLibre needs to wrap it correctly.
 */
export function unwrapLongitude(lng: number, near: number): number {
  let out = lng;
  while (out - near > 180) out -= 360;
  while (out - near < -180) out += 360;
  return out;
}

/**
 * The two-point line shown for a flight leg, in GeoJSON [lng, lat] order.
 *
 * Deliberately two points rather than an interpolated great-circle arc: in Web
 * Mercator this renders as the straight line between the stops, which is
 * exactly the "this is not a drive" signal we want. An arc would look like a
 * route.
 */
export function flightLine(from: Point, to: Point): [number, number][] {
  return [
    [from.lng, from.lat],
    [unwrapLongitude(to.lng, from.lng), to.lat],
  ];
}
