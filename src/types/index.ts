import type { TravelProfile } from '@/lib/limits';

/** Wire shapes: the same rows, with Dates serialised as ISO strings. */

export interface StopDto {
  id: string;
  tripId: string;
  position: number;
  name: string;
  address: string | null;
  lng: number;
  lat: number;
  notes: string | null;
  days: number;
  profileToNext: TravelProfile | null;
  createdAt: string;
}

export interface TripDto {
  id: string;
  title: string;
  defaultProfile: TravelProfile;
  shareSlug: string | null;
  sharedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface TripListItem {
  id: string;
  title: string;
  defaultProfile: TravelProfile;
  shareSlug: string | null;
  version: number;
  updatedAt: string;
  stopCount: number;
}

export interface SummaryLegDto {
  fromStopId: string;
  toStopId: string;
  profile: TravelProfile;
  distanceM: number;
  durationS: number;
  geometry: string;
  fetchedAt: string;
  /** No road connects these stops: great-circle distance, no travel time. */
  isFlight: boolean;
}

export interface SummaryDto {
  legs: SummaryLegDto[];
  /** Ground travel only — flights are reported in totalFlightDistanceM. */
  totalDistanceM: number;
  totalDurationS: number;
  totalNights: number;
  stopCount: number;
  /** Continuous drivable runs, [lng, lat] pairs in GeoJSON order. */
  roadSegments: [number, number][][];
  /** One straight two-point line per flight leg. */
  flightSegments: [number, number][][];
  flightLegCount: number;
  totalFlightDistanceM: number;
  estimatesFetchedAt: string | null;
  legCount: number;
  fetchedLegCount: number;
  estimateAgeDays: number | null;
}

export interface GeocodeHit {
  name: string;
  address: string | null;
  lng: number;
  lat: number;
  /** Feature type label, e.g. "City", "County". Shown so the two are tellable apart. */
  kind: string;
  tier: number;
}

export interface ApiErrorBody {
  error: string;
  message?: string;
  retryAfterSeconds?: number;
  scope?: string;
  currentVersion?: number;
  limit?: number;
}
