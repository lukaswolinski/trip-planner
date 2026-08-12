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
}

export interface SummaryDto {
  legs: SummaryLegDto[];
  totalDistanceM: number;
  totalDurationS: number;
  totalNights: number;
  stopCount: number;
  /** [lng, lat] pairs, GeoJSON order. */
  geometry: [number, number][];
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
