/**
 * Ranking and labelling geocoder results.
 *
 * The fixtures are real Photon output, captured from the live service for the
 * queries that misbehaved.
 */

import { describe, expect, it } from 'vitest';
import { TIER, classifyFeature, rankByTier } from '@/lib/geocoding/rank';

describe('classifying features', () => {
  it('treats settlements as the best kind of stop', () => {
    expect(classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'city' })).toEqual({
      tier: TIER.settlement,
      label: 'City',
    });
    expect(classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'town' })).toEqual({
      tier: TIER.settlement,
      label: 'Town',
    });
    expect(
      classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'village' }),
    ).toEqual({ tier: TIER.settlement, label: 'Village' });
  });

  it('demotes a county even though Photon calls it place=county', () => {
    // This is the Houston bug: the county arrives as `place=county`, so a naive
    // "is it a place?" check would treat it as a settlement.
    expect(
      classifyFeature({ type: 'county', osmKey: 'place', osmValue: 'county' }),
    ).toEqual({ tier: TIER.administrative, label: 'County' });
  });

  it('demotes administrative and statistical boundaries', () => {
    expect(
      classifyFeature({ type: 'county', osmKey: 'boundary', osmValue: 'administrative' }),
    ).toEqual({ tier: TIER.administrative, label: 'Admin area' });
    expect(
      classifyFeature({ type: 'other', osmKey: 'boundary', osmValue: 'statistical' }),
    ).toEqual({ tier: TIER.administrative, label: 'Metro area' });
  });

  it('keeps a national park as a destination, not a region', () => {
    // "San Antonio Missions National Historical Park" is somewhere you go.
    expect(
      classifyFeature({ type: 'other', osmKey: 'boundary', osmValue: 'protected_area' }),
    ).toEqual({ tier: TIER.feature, label: 'Protected area' });
  });

  it('labels named features by their specific value', () => {
    expect(classifyFeature({ osmKey: 'leisure', osmValue: 'stadium' }).label).toBe('Stadium');
    expect(classifyFeature({ osmKey: 'amenity', osmValue: 'university' }).label).toBe(
      'University',
    );
    expect(classifyFeature({ osmKey: 'aeroway', osmValue: 'aerodrome' }).label).toBe(
      'Aerodrome',
    );
    expect(classifyFeature({ osmKey: 'waterway', osmValue: 'river' }).label).toBe('River');
    // Trailheads and campsites are the point of the app; they must stay usable.
    expect(classifyFeature({ osmKey: 'tourism', osmValue: 'camp_site' })).toEqual({
      tier: TIER.feature,
      label: 'Camp Site',
    });
  });

  it('handles suburbs and localities as sub-places', () => {
    expect(classifyFeature({ type: 'district', osmKey: 'place', osmValue: 'suburb' })).toEqual(
      { tier: TIER.feature, label: 'Suburb' },
    );
  });

  it('maps Mapbox feature_type values with no osm fields', () => {
    expect(classifyFeature({ type: 'place' })).toEqual({
      tier: TIER.settlement,
      label: 'City',
    });
    expect(classifyFeature({ type: 'region' })).toEqual({
      tier: TIER.administrative,
      label: 'Region',
    });
    expect(classifyFeature({ type: 'poi' }).tier).toBe(TIER.feature);
  });

  it('never throws on empty or unknown input', () => {
    expect(classifyFeature({})).toEqual({ tier: TIER.feature, label: 'Place' });
    expect(classifyFeature({ type: 'wat', osmKey: 'zzz', osmValue: 'qqq' }).label).toBe('Qqq');
  });
});

describe('ranking', () => {
  /** Real Photon output for "Houston, Texas", in the order it arrived. */
  const houston = [
    { name: 'Houston', lat: 29.7589, ...classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'city' }) },
    { name: 'Houston County', lat: 31.3378, ...classifyFeature({ type: 'county', osmKey: 'place', osmValue: 'county' }) },
    { name: 'Houston MO', lat: 37.3262, ...classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'village' }) },
    { name: 'Greater Houston', lat: 29.7999, ...classifyFeature({ type: 'other', osmKey: 'boundary', osmValue: 'statistical' }) },
    { name: 'NRG Astrodome', lat: 29.6849, ...classifyFeature({ osmKey: 'leisure', osmValue: 'stadium' }) },
  ];

  it('puts the city first and the county below every real place', () => {
    const ranked = rankByTier(houston);
    expect(ranked[0].name).toBe('Houston');
    expect(ranked[0].lat).toBeCloseTo(29.7589, 4);

    const countyIndex = ranked.findIndex((r) => r.name === 'Houston County');
    const villageIndex = ranked.findIndex((r) => r.name === 'Houston MO');
    const stadiumIndex = ranked.findIndex((r) => r.name === 'NRG Astrodome');
    expect(countyIndex).toBeGreaterThan(villageIndex);
    expect(countyIndex).toBeGreaterThan(stadiumIndex);
  });

  it('preserves the provider order within a tier', () => {
    // The provider's relevance ranking is usually right; we only demote regions.
    const ranked = rankByTier(houston);
    const settlements = ranked.filter((r) => r.tier === TIER.settlement).map((r) => r.name);
    expect(settlements).toEqual(['Houston', 'Houston MO']);
  });

  it('sinks the Oaxaca administrative boundaries in a San Antonio search', () => {
    const sanAntonio = [
      { name: 'San Antonio TX', ...classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'city' }) },
      { name: 'San Antonio CL', ...classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'city' }) },
      { name: 'San Antonio Huitepec', ...classifyFeature({ type: 'county', osmKey: 'boundary', osmValue: 'administrative' }) },
      { name: 'San Antonio Sinicahua', ...classifyFeature({ type: 'county', osmKey: 'boundary', osmValue: 'administrative' }) },
      { name: 'San Antonio de Benagéber', ...classifyFeature({ type: 'city', osmKey: 'place', osmValue: 'village' }) },
    ];
    const ranked = rankByTier(sanAntonio).map((r) => r.name);
    expect(ranked.slice(0, 3)).toEqual([
      'San Antonio TX',
      'San Antonio CL',
      'San Antonio de Benagéber',
    ]);
  });

  it('does not mutate its input', () => {
    const input = [...houston];
    rankByTier(input);
    expect(input.map((r) => r.name)).toEqual(houston.map((r) => r.name));
  });
});
