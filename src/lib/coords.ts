/**
 * Recognising pasted coordinates in the stop search box.
 *
 * Pure and dependency-free so the parsing rules can be tested exhaustively —
 * this is input handling, where the edge cases are the whole job.
 */

export interface ParsedCoordinate {
  lat: number;
  lng: number;
  /**
   * True when the input only made sense read as "lng, lat".
   *
   * Both orders exist in the wild: Google Maps and phone GPS give lat,lng, while
   * GeoJSON and most APIs give lng,lat. We prefer lat,lng (what a person is most
   * likely pasting) and only fall back to the swap when that reading is
   * impossible — then say so in the UI rather than silently guessing.
   */
  swapped: boolean;
}

const LAT_MAX = 90;
const LNG_MAX = 180;

/**
 * Splits on a comma or whitespace, tolerating the punctuation people paste along
 * with coordinates: parentheses, degree signs.
 *
 * Standalone hemisphere letters are merged back onto the preceding number, so
 * "38.574° N" is one value rather than two tokens. Without that merge, any input
 * written with a space before N/S/E/W produced four tokens and was rejected.
 */
function tokenize(input: string): string[] {
  const rough = input
    .trim()
    .replace(/[()[\]]/g, ' ')
    .replace(/[°º]/g, ' ') // degree sign, masculine ordinal
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((part) => part.length > 0);

  const merged: string[] = [];
  for (const token of rough) {
    const isHemisphere = /^[NSEW]$/i.test(token);
    if (isHemisphere && merged.length > 0 && /[0-9]$/.test(merged[merged.length - 1])) {
      merged[merged.length - 1] += token;
    } else {
      merged.push(token);
    }
  }
  return merged;
}

/**
 * Accepts an optional N/S/E/W suffix or prefix and returns a signed number.
 * "38.574N" -> 38.574, "109.546W" -> -109.546
 */
function parseSignedNumber(token: string): number | null {
  const match = /^([NSEW])?(-?\+?[0-9]*\.?[0-9]+)([NSEW])?$/i.exec(token);
  if (!match) return null;

  const hemisphere = (match[1] ?? match[3] ?? '').toUpperCase();
  if (match[1] && match[3]) return null; // a hemisphere at both ends is nonsense

  const magnitude = Number(match[2]);
  if (!Number.isFinite(magnitude)) return null;

  // A hemisphere letter and an explicit minus sign together are contradictory.
  if (hemisphere && magnitude < 0) return null;

  if (hemisphere === 'S' || hemisphere === 'W') return -Math.abs(magnitude);
  return magnitude;
}

function inRange(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= LAT_MAX &&
    Math.abs(lng) <= LNG_MAX
  );
}

/**
 * Returns coordinates if the input is a coordinate pair, else null.
 *
 * Deliberately strict: exactly two numeric tokens. A query like "38 Main Street"
 * has two tokens but one is not numeric, and "Bend 97701" must stay a place
 * search rather than becoming a point in the Gulf of Guinea.
 */
export function parseCoordinateInput(input: string): ParsedCoordinate | null {
  if (!input) return null;

  const tokens = tokenize(input);
  if (tokens.length !== 2) return null;

  const first = parseSignedNumber(tokens[0]);
  const second = parseSignedNumber(tokens[1]);
  if (first === null || second === null) return null;

  // Require a decimal point in at least one value. Bare integer pairs like
  // "12 30" are far more likely to be a street number or a search phrase than
  // an intended location, and silently turning them into coordinates is worse
  // than making the user add a decimal.
  if (!/\./.test(tokens[0]) && !/\./.test(tokens[1])) return null;

  if (inRange(first, second)) {
    return { lat: first, lng: second, swapped: false };
  }

  // Only reachable when the natural reading is out of range, e.g. "-109.5, 38.5".
  if (inRange(second, first)) {
    return { lat: second, lng: first, swapped: true };
  }

  return null;
}

/** Fixed 5 decimal places — about 1.1 m, matching the routing cache precision. */
export function formatCoordinates(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
