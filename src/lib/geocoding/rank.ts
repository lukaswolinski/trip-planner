/**
 * Classifying and ranking geocoder results.
 *
 * The problem this solves, verified against live Photon output: searching
 * "Houston, Texas" returns the city (29.7589, -95.3677) *and* Houston County
 * (31.3378, -95.3908, out near Crockett). Both are called "Houston", and the
 * county's only distinguishing field is a missing county name — so the two rows
 * looked identical in the dropdown and picking the wrong one was easy.
 * "San Antonio" is worse: five of eight results are administrative boundaries in
 * Oaxaca.
 *
 * Two fixes, both here: a coarse tier so administrative areas sort below real
 * places, and a human label so the dropdown can say which is which.
 *
 * Pure and provider-neutral so the rules are directly testable.
 */

/** Lower sorts first. */
export const TIER = {
  /** Somewhere you would actually stop: a settlement. */
  settlement: 0,
  /** A specific feature — trailhead, park, campsite, airport, university. */
  feature: 1,
  /** A region on a map rather than a place you drive to. */
  administrative: 2,
} as const;

export type Tier = (typeof TIER)[keyof typeof TIER];

export interface FeatureClassInput {
  /** Photon's coarse `type`, or a Mapbox `feature_type`. */
  type?: string | null;
  /** Photon's `osm_key` (e.g. `place`, `boundary`, `amenity`). */
  osmKey?: string | null;
  /** Photon's `osm_value` (e.g. `city`, `county`, `administrative`). */
  osmValue?: string | null;
}

export interface FeatureClass {
  tier: Tier;
  /** Short label for the UI, e.g. "City", "County", "Protected area". */
  label: string;
}

/** place=* values that are settlements, best first. */
const SETTLEMENT_VALUES: Record<string, string> = {
  city: 'City',
  town: 'Town',
  village: 'Village',
  hamlet: 'Hamlet',
  borough: 'Borough',
  municipality: 'Municipality',
};

/** place=* values that describe part of a settlement. */
const SUBPLACE_VALUES: Record<string, string> = {
  suburb: 'Suburb',
  neighbourhood: 'Neighbourhood',
  quarter: 'Quarter',
  locality: 'Locality',
  isolated_dwelling: 'Locality',
  farm: 'Locality',
};

/** Explicitly administrative: regions, not destinations. */
const ADMIN_VALUES: Record<string, string> = {
  county: 'County',
  state: 'State',
  province: 'Province',
  region: 'Region',
  district: 'District',
  country: 'Country',
  administrative: 'Admin area',
  statistical: 'Metro area',
  census: 'Census area',
  political: 'Admin area',
};

/** Keys whose values are worth naming directly. */
const FEATURE_KEY_LABELS: Record<string, string> = {
  aeroway: 'Airport',
  waterway: 'Waterway',
  natural: 'Natural feature',
  leisure: 'Leisure',
  tourism: 'Attraction',
  amenity: 'Amenity',
  historic: 'Historic site',
  shop: 'Shop',
  railway: 'Station',
  man_made: 'Landmark',
  highway: 'Road',
  building: 'Building',
  landuse: 'Area',
};

function titleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

/**
 * Note the ordering of the checks: `boundary=*` and explicit administrative
 * values are tested before the generic key lookup, because a county arrives as
 * `place=county` and would otherwise be mistaken for a place.
 */
export function classifyFeature(input: FeatureClassInput): FeatureClass {
  const type = (input.type ?? '').toLowerCase();
  const key = (input.osmKey ?? '').toLowerCase();
  const value = (input.osmValue ?? '').toLowerCase();

  // 1. Settlements.
  if (key === 'place' && SETTLEMENT_VALUES[value]) {
    return { tier: TIER.settlement, label: SETTLEMENT_VALUES[value] };
  }

  // 2. Administrative areas, however they are spelled.
  if (key === 'boundary' || ADMIN_VALUES[value]) {
    const label = ADMIN_VALUES[value] ?? (value ? titleCase(value) : 'Admin area');
    // A protected area is a national park — a genuine destination, not a region.
    if (value === 'protected_area' || value === 'national_park') {
      return { tier: TIER.feature, label: 'Protected area' };
    }
    return { tier: TIER.administrative, label };
  }

  // 3. Parts of a settlement.
  if (key === 'place' && SUBPLACE_VALUES[value]) {
    return { tier: TIER.feature, label: SUBPLACE_VALUES[value] };
  }

  // 4. Named features. The value is more informative than the key when we have
  //    it ("Stadium" beats "Leisure").
  if (key && FEATURE_KEY_LABELS[key]) {
    return {
      tier: TIER.feature,
      label: value ? titleCase(value) : FEATURE_KEY_LABELS[key],
    };
  }

  // 5. Fall back to the provider's coarse type. Mapbox uses these directly.
  switch (type) {
    case 'city':
      return { tier: TIER.settlement, label: 'City' };
    case 'place':
      return { tier: TIER.settlement, label: 'City' };
    case 'town':
      return { tier: TIER.settlement, label: 'Town' };
    case 'village':
      return { tier: TIER.settlement, label: 'Village' };
    case 'locality':
      return { tier: TIER.feature, label: 'Locality' };
    case 'district':
      return { tier: TIER.administrative, label: 'District' };
    case 'county':
      return { tier: TIER.administrative, label: 'County' };
    case 'state':
    case 'region':
      return { tier: TIER.administrative, label: 'Region' };
    case 'country':
      return { tier: TIER.administrative, label: 'Country' };
    case 'postcode':
      return { tier: TIER.administrative, label: 'Postcode' };
    case 'street':
      return { tier: TIER.feature, label: 'Street' };
    case 'address':
      return { tier: TIER.feature, label: 'Address' };
    case 'house':
      return { tier: TIER.feature, label: value ? titleCase(value) : 'Place' };
    case 'poi':
      return { tier: TIER.feature, label: 'Point of interest' };
    default:
      return { tier: TIER.feature, label: value ? titleCase(value) : 'Place' };
  }
}

/**
 * Sorts by tier only, preserving the provider's order inside each tier.
 *
 * Deliberately minimal: the provider's relevance ranking is usually good — for
 * "Houston, Texas" it already put the city first — so this only demotes
 * administrative areas rather than trying to re-score everything.
 * `Array.prototype.sort` is stable in modern JS, which is what preserves the
 * within-tier order.
 */
export function rankByTier<T extends { tier: number }>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => a.tier - b.tier);
}
