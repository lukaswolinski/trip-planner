'use client';

import type {
  ApiErrorBody,
  GeocodeHit,
  ItineraryItemDto,
  StopDto,
  SummaryDto,
  TripDto,
} from '@/types';
import type { TravelProfile } from '@/lib/limits';

/** Thrown for any non-2xx response, carrying the server's error code. */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get isRateLimited(): boolean {
    return this.code === 'RATE_LIMITED';
  }

  get needsEmail(): boolean {
    return this.code === 'EMAIL_REQUIRED';
  }

  get isConflict(): boolean {
    return this.code === 'CONFLICT';
  }
}

async function call<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;

  const response = await fetch(path, {
    ...rest,
    headers: {
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...rest.headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  if (!response.ok) {
    let body: ApiErrorBody = { error: 'SERVER_ERROR' };
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // Non-JSON error page; keep the default.
    }
    throw new ApiError(
      body.error ?? 'SERVER_ERROR',
      body.message ?? `Request failed with ${response.status}`,
      response.status,
      body,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  createTrip: (json: { title?: string; defaultProfile?: TravelProfile }) =>
    call<{ trip: TripDto }>('/api/trips', { method: 'POST', json }),

  deleteTrip: (tripId: string) =>
    call<{ deleted: true }>(`/api/trips/${tripId}`, { method: 'DELETE' }),

  patchTrip: (
    tripId: string,
    json: {
      title?: string;
      defaultProfile?: TravelProfile;
      pinned?: boolean;
      version: number;
    },
  ) => call<{ trip: TripDto }>(`/api/trips/${tripId}`, { method: 'PATCH', json }),

  addItineraryItem: (
    tripId: string,
    stopId: string,
    json: { title: string; notes?: string | null; startMinutes?: number | null },
  ) =>
    call<{ item: ItineraryItemDto }>(
      `/api/trips/${tripId}/stops/${stopId}/itinerary`,
      { method: 'POST', json },
    ),

  patchItineraryItem: (
    tripId: string,
    stopId: string,
    itemId: string,
    json: { title?: string; notes?: string | null; startMinutes?: number | null },
  ) =>
    call<{ item: ItineraryItemDto }>(
      `/api/trips/${tripId}/stops/${stopId}/itinerary/${itemId}`,
      { method: 'PATCH', json },
    ),

  deleteItineraryItem: (tripId: string, stopId: string, itemId: string) =>
    call<{ deleted: true }>(
      `/api/trips/${tripId}/stops/${stopId}/itinerary/${itemId}`,
      { method: 'DELETE' },
    ),

  reorderItinerary: (tripId: string, stopId: string, orderedIds: string[]) =>
    call<{ items: ItineraryItemDto[] }>(
      `/api/trips/${tripId}/stops/${stopId}/itinerary/reorder`,
      { method: 'POST', json: { orderedIds } },
    ),

  addStop: (
    tripId: string,
    json: {
      name: string;
      address?: string | null;
      lat: number;
      lng: number;
      position?: number;
    },
  ) =>
    call<{
      stop: StopDto;
      stopCount: number;
      overSoftCap: boolean;
      softCap: number;
    }>(`/api/trips/${tripId}/stops`, { method: 'POST', json }),

  patchStop: (
    tripId: string,
    stopId: string,
    json: {
      name?: string;
      notes?: string | null;
      days?: number;
      profileToNext?: TravelProfile | null;
      lat?: number;
      lng?: number;
    },
  ) =>
    call<{ stop: StopDto }>(`/api/trips/${tripId}/stops/${stopId}`, {
      method: 'PATCH',
      json,
    }),

  deleteStop: (tripId: string, stopId: string) =>
    call<{ deleted: true }>(`/api/trips/${tripId}/stops/${stopId}`, {
      method: 'DELETE',
    }),

  reorder: (tripId: string, stopIds: string[]) =>
    call<{ stops: StopDto[] }>(`/api/trips/${tripId}/reorder`, {
      method: 'POST',
      json: { stopIds },
    }),

  routeSummary: (tripId: string) =>
    call<SummaryDto>(`/api/trips/${tripId}/route-summary`, { method: 'POST' }),

  geocode: (query: string, near?: { lat: number; lng: number }) => {
    const params = new URLSearchParams({ q: query });
    if (near) {
      params.set('lat', String(near.lat));
      params.set('lng', String(near.lng));
    }
    return call<{ results: GeocodeHit[] }>(`/api/geocode?${params.toString()}`);
  },

  reverseGeocode: (lat: number, lng: number) =>
    call<{ result: GeocodeHit | null; supported: boolean }>(
      `/api/geocode/reverse?lat=${lat}&lng=${lng}`,
    ),

  share: (tripId: string) =>
    call<{ shareSlug: string; shareUrl: string; sharedAt: string | null }>(
      `/api/trips/${tripId}/share`,
      { method: 'POST' },
    ),

  revokeShare: (tripId: string) =>
    call<{ revoked: true }>(`/api/trips/${tripId}/share`, { method: 'DELETE' }),

  requestSignIn: (json: { email: string; tripId?: string }) =>
    call<{
      sent: boolean;
      /** Present only when no email provider is configured. */
      reason?: string;
      /** Development-only fallback so sign-in can still be completed. */
      devLink?: string;
      message?: string;
    }>('/api/auth/request', { method: 'POST', json }),
};
