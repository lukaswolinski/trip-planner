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
  /**
   * Ordering *within* a tier, lower first: city before town before village.
   * Non-settlements all share NON_SETTLEMENT_RANK.
   */
  placeRank: number;
}

/**
 * place=* values that are settlements, with OSM's own size ordering.
 *
 * This is the fix for "Munich" landing on Munich, North Dakota: both it and
 * München are settlements, so the tier alone could not separate them and the
 * provider's order won. OSM already classifies one `place=city` and the other
 * `place=village` — that distinction just was not being used.
 */
const SETTLEMENT_VALUES: Record<string, { label: string; rank: number }> = {
  city: { label: 'City', rank: 0 },
  municipality: { label: 'Municipality', rank: 1 },
  borough: { label: 'Borough', rank: 2 },
  town: { label: 'Town', rank: 3 },
  village: { label: 'Village', rank: 4 },
  hamlet: { label: 'Hamlet', rank: 5 },
};

/** Anything that is not a settlement sorts after every settlement class. */
export const NON_SETTLEMENT_RANK = 10;

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
  // Everything defaults to the non-settlement rank; only the branches that
  // identify a settlement class override it.
  return { placeRank: NON_SETTLEMENT_RANK, ...classify(input) };
}

function classify(
  input: FeatureClassInput,
): Omit<FeatureClass, 'placeRank'> & { placeRank?: number } {
  const type = (input.type ?? '').toLowerCase();
  const key = (input.osmKey ?? '').toLowerCase();
  const value = (input.osmValue ?? '').toLowerCase();

  // 1. Settlements.
  const settlement = SETTLEMENT_VALUES[value];
  if (key === 'place' && settlement) {
    return {
      tier: TIER.settlement,
      label: settlement.label,
      placeRank: settlement.rank,
    };
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
      return { tier: TIER.settlement, label: 'City', placeRank: 0 };
    case 'place':
      return { tier: TIER.settlement, label: 'City', placeRank: 0 };
    case 'town':
      return { tier: TIER.settlement, label: 'Town', placeRank: 3 };
    case 'village':
      return { tier: TIER.settlement, label: 'Village', placeRank: 4 };
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

export interface Rankable {
  tier: number;
  placeRank: number;
}

/**
 * Orders results: tier, then settlement class, then the provider's own order.
 *
 * `Array.prototype.sort` is stable, so equal-scoring results keep the order the
 * provider returned them in — which, once `lang=en` is sent, is good.
 *
 * ## Why there is no size or population weighting
 *
 * Photon returns no population field. Its `extent` bounding box looked like a
 * usable proxy (Munich, Germany covers ~90x the area of Munich, North Dakota),
 * so it was built and measured against the five known-bad queries.
 *
 * **It made things worse.** Florence, South Carolina has a larger bounding box
 * than Florence, Italy — both are `place=city`, so the size tiebreak promoted
 * the wrong one and turned a correct result into a regression. Physical
 * footprint tracks municipal boundary drawing, not importance: sprawling
 * low-density towns out-measure dense famous cities routinely.
 *
 * Sending `lang=en` plus the settlement-class ordering resolves all five
 * (Munich, Florence, Vienna, Naples, Cologne) on its own. Don't re-add extent
 * weighting without a population source to check it against.
 */
export function rankResults<T extends Rankable>(results: readonly T[]): T[] {
  return [...results].sort((a, b) => a.tier - b.tier || a.placeRank - b.placeRank);
}
