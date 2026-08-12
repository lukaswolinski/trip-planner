/**
 * Encoded polyline codec (the Google algorithm, default precision 6 to match
 * Mapbox's `geometries=polyline6`).
 *
 * Coordinate order: the wire format encodes latitude first, but every function
 * here returns and accepts `[lng, lat]` pairs, because that is GeoJSON order
 * and what Mapbox GL JS expects. Getting this backwards puts your route in the
 * ocean, so the conversion happens in exactly one place: here.
 */

export type LngLat = [number, number];

export function decodePolyline(encoded: string, precision = 6): LngLat[] {
  const factor = 10 ** precision;
  const points: LngLat[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63 - 1;
      result += byte << shift;
      shift += 5;
    } while (byte >= 0x1f);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lng / factor, lat / factor]);
  }

  return points;
}

export function encodePolyline(points: LngLat[], precision = 6): string {
  const factor = 10 ** precision;
  let output = '';
  let prevLat = 0;
  let prevLng = 0;

  for (const [lng, lat] of points) {
    const scaledLat = Math.round(lat * factor);
    const scaledLng = Math.round(lng * factor);
    output += encodeSigned(scaledLat - prevLat);
    output += encodeSigned(scaledLng - prevLng);
    prevLat = scaledLat;
    prevLng = scaledLng;
  }

  return output;
}

function encodeSigned(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (v >= 0x20) {
    output += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  output += String.fromCharCode(v + 63);
  return output;
}

/**
 * Joins point sequences end to end, dropping the duplicated seam point where
 * one sequence ends and the next begins. Used both to build a leg's geometry
 * from its steps and to stitch a whole trip's polyline from its legs.
 */
export function joinPointSequences(sequences: LngLat[][]): LngLat[] {
  const out: LngLat[] = [];
  for (const seq of sequences) {
    if (seq.length === 0) continue;
    if (out.length === 0) {
      out.push(...seq);
      continue;
    }
    const last = out[out.length - 1];
    const first = seq[0];
    const seam = last[0] === first[0] && last[1] === first[1];
    out.push(...(seam ? seq.slice(1) : seq));
  }
  return out;
}

/** Decodes several encoded polylines and stitches them into one point list. */
export function stitchEncoded(encoded: string[], precision = 6): LngLat[] {
  return joinPointSequences(encoded.map((e) => decodePolyline(e, precision)));
}
