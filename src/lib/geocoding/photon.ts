/**
 * Photon (komoot) geocoding â€” the keyless default.
 *
 * Photon rather than Nominatim because it is purpose-built for type-ahead
 * search, which is exactly what the stop search box does. Nominatim's usage
 * policy caps at 1 request/second and asks that autocomplete-style use be
 * avoided; Photon is the OSM-ecosystem answer for that shape of query.
 *
 * Data is OSM under ODbL, so unlike Mapbox's temporary geocoding there is no
 * restriction on storing the returned coordinates â€” which is what our `stops`
 * table does by definition. Attribution is required.
 *
 * The response is a GeoJSON FeatureCollection. Verified shape:
 *
 *   features[].geometry.coordinates = [lng, lat]
 *   features[].properties = { name, street, housenumber, city, county, state,
 *                             postcode, country, countrycode, osm_key,
 *                             osm_value, type, extent? }
 *
 * There is no single `full_address` field, so the address line is composed from
 * parts below.
 */
import 'server-only';

import { createThrottle } from '@/lib/routing/throttle';
import { osmUserAgent } from '@/lib/routing/providers/osrm';
import { classifyFeature, rankResults } from './rank';
import type { GeocodeOptions, GeocodeResult, Geocoder } from './types';

const DEFAULT_BASE_URL = 'https://photon.komoot.io';

/**
 * Photon supports en, de and fr. English is the only one of those that helps a
 * general audience search for European cities by their English exonyms.
 */
const PHOTON_LANG = 'en';

function baseUrl(): string {
  return (process.env.PHOTON_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

/** Courtesy pacing; see the scope caveat in throttle.ts. */
const throttle = createThrottle(Number(process.env.PHOTON_MIN_INTERVAL_MS ?? 1100));

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    county?: string;
    state?: string;
    postcode?: string;
    country?: string;
    type?: string;
    osm_key?: string;
    osm_value?: string;
    /** [west, north, east, south]; present for areas, absent for points. */
    extent?: number[];
  };
}

export function createPhotonGeocoder(): Geocoder {
  return {
    name: 'photon',
    async search(query, options: GeocodeOptions = {}) {
      const params = new URLSearchParams({
        q: query,
        limit: String(options.limit ?? 5),
        // `lang` is what makes alternate names searchable, and it does more
        // work than any ranking rule here. Without it, "Munich" never matches
        // MÃ¼nchen (whose OSM name is German) so a North Dakota village wins on
        // an exact string match; "Cologne" returns no German result at all in
        // the top six. With lang=en, all of Munich, Florence, Vienna, Naples
        // and Cologne resolve to the European city first. Names come back in
        // English too, which is what the user typed.
        lang: PHOTON_LANG,
      });
      if (options.proximity) {
        params.set('lat', String(options.proximity.lat));
        params.set('lon', String(options.proximity.lng));
      }

      const response = await throttle.run(() =>
        fetch(`${baseUrl()}/api/?${params.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json', 'User-Agent': osmUserAgent() },
        }),
      );

      if (!response.ok) {
        throw new Error(
          `Photon responded ${response.status} ${response.statusText}`,
        );
      }

      const data = (await response.json()) as { features?: PhotonFeature[] };
      // Demote counties and boundaries below settlements, then order
      // settlements city-before-town-before-village.
      return rankResults((data.features ?? []).flatMap(toResult));
    },

    /** Photon exposes /reverse; one request, same courtesy throttle. */
    async reverse(lat, lng) {
      const params = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        limit: '1',
      });

      const response = await throttle.run(() =>
        fetch(`${baseUrl()}/reverse?${params.toString()}`, {
          cache: 'no-store',
          headers: { Accept: 'application/json', 'User-Agent': osmUserAgent() },
        }),
      );

      if (!response.ok) {
        throw new Error(`Photon reverse responded ${response.status}`);
      }

      const data = (await response.json()) as { features?: PhotonFeature[] };
      const [first] = (data.features ?? []).flatMap(toResult);
      return first ?? null;
    },
  };
}

function toResult(feature: PhotonFeature): GeocodeResult[] {
  const coords = feature.geometry?.coordinates;
  const lng = coords?.[0];
  const lat = coords?.[1];
  if (typeof lng !== 'number' || typeof lat !== 'number') return [];

  const p = feature.properties ?? {};
  const { tier, label, placeRank } = classifyFeature({
    type: p.type,
    osmKey: p.osm_key,
    osmValue: p.osm_value,
  });

  // Photon puts the place name in `name` for POIs and settlements, but a plain
  // address match may only have street/housenumber.
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  const name = p.name || street || p.city || 'Unnamed place';

  // Compose the secondary line from whichever administrative parts exist,
  // skipping any that merely repeat the name.
  const parts = [
    street && street !== name ? street : null,
    p.city,
    p.district && p.district !== p.city ? p.district : null,
    p.county && p.county !== p.city ? p.county : null,
    p.state,
    p.postcode,
    p.country,
  ]
    .filter((part): part is string => Boolean(part) && part !== name)
    .filter((part, index, all) => all.indexOf(part) === index);

  return [
    {
      name,
      address: parts.length > 0 ? parts.join(', ') : null,
      lng,
      lat,
      kind: label,
      tier,
      placeRank,
    },
  ];
}
