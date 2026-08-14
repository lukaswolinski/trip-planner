'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import { formatCoordinates, parseCoordinateInput } from '@/lib/coords';
import type { GeocodeHit } from '@/types';

interface Props {
  onPick: (hit: GeocodeHit) => void;
  /** Bias results toward the current map centre. */
  near?: { lat: number; lng: number };
  disabled?: boolean;
}

export default function StopSearch({ onPick, near, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A name found by reverse geocoding the pasted coordinate, if any. */
  const [coordName, setCoordName] = useState<{ key: string; name: string } | null>(null);
  const requestId = useRef(0);
  const reverseId = useRef(0);

  const nearLat = near?.lat;
  const nearLng = near?.lng;

  /**
   * Coordinates are recognised before the geocoder is ever consulted, so pasting
   * a point never costs a network request or waits on the 1 req/s courtesy limit.
   */
  const coords = useMemo(() => parseCoordinateInput(query), [query]);
  const coordKey = coords ? `${coords.lat},${coords.lng}` : null;

  const active = query.trim().length >= 2;

  // Place search. Skipped entirely while the input parses as coordinates.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2 || parseCoordinateInput(trimmed)) return;

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setBusy(true);
      try {
        const { results } = await api.geocode(
          trimmed,
          nearLat !== undefined && nearLng !== undefined
            ? { lat: nearLat, lng: nearLng }
            : undefined,
        );
        if (id === requestId.current) {
          setHits(results);
          setError(null);
        }
      } catch (err) {
        if (id === requestId.current) {
          setHits([]);
          setError(
            err instanceof ApiError && err.isRateLimited
              ? 'Searching too fast — please wait a moment.'
              : 'Place search is unavailable right now.',
          );
        }
      } finally {
        if (id === requestId.current) setBusy(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query, nearLat, nearLng]);

  /**
   * Look up a name for the pasted point in the background.
   *
   * The coordinate row is usable immediately with the numbers as its label; this
   * only upgrades the label if the lookup returns in time. A failure is ignored
   * on purpose — coordinates are a perfectly good stop name.
   */
  useEffect(() => {
    if (!coords || !coordKey) return;

    const id = ++reverseId.current;
    const timer = setTimeout(async () => {
      try {
        const { result } = await api.reverseGeocode(coords.lat, coords.lng);
        if (id === reverseId.current && result?.name) {
          setCoordName({ key: coordKey, name: result.name });
        }
      } catch {
        // Non-fatal: keep the coordinates as the name.
      }
    }, 400);

    return () => clearTimeout(timer);
  }, [coords, coordKey]);

  function pickCoordinates() {
    if (!coords) return;
    const label = coordName?.key === coordKey ? coordName.name : null;
    onPick({
      name: label ?? formatCoordinates(coords.lat, coords.lng),
      // Keep the exact numbers visible even when a name was found.
      address: formatCoordinates(coords.lat, coords.lng),
      lat: coords.lat,
      lng: coords.lng,
      kind: 'Coordinates',
      tier: 0,
    });
    setQuery('');
    setHits([]);
    setCoordName(null);
  }

  const resolvedName = coordName?.key === coordKey ? coordName.name : null;

  return (
    <div className="relative">
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        disabled={disabled}
        placeholder="Add a stop — place name or 38.574, -109.546"
        className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent disabled:opacity-50"
        aria-label="Search for a place, or paste coordinates"
        autoComplete="off"
        onKeyDown={(event) => {
          // Enter accepts a recognised coordinate without reaching for the mouse.
          if (event.key === 'Enter' && coords) {
            event.preventDefault();
            pickCoordinates();
          }
        }}
      />

      {busy ? (
        <span className="absolute right-3 top-2.5 text-xs text-ink-faint">
          …
        </span>
      ) : null}

      {active && !coords && error ? (
        <p className="mt-1 text-xs text-ink">{error}</p>
      ) : null}

      {coords ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-control border border-line bg-surface shadow-lg">
          <li>
            <button
              type="button"
              onClick={pickCoordinates}
              className="block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft"
            >
              <span className="flex items-center gap-2">
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-blue-800">
                  Coordinates
                </span>
                <span className="font-medium">
                  {resolvedName ?? formatCoordinates(coords.lat, coords.lng)}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-ink-muted">
                {resolvedName ? `${formatCoordinates(coords.lat, coords.lng)} · ` : ''}
                {coords.swapped
                  ? 'read as longitude, latitude'
                  : 'latitude, longitude'}
              </span>
            </button>
          </li>
        </ul>
      ) : active && hits.length > 0 ? (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-control border border-line bg-surface shadow-lg">
          {hits.map((hit, index) => (
            <li key={`${hit.lng},${hit.lat},${index}`}>
              <button
                type="button"
                onClick={() => {
                  onPick(hit);
                  setQuery('');
                  setHits([]);
                }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-accent-soft"
              >
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{hit.name}</span>
                  {/*
                    The type badge is the fix for "Houston, Texas" landing in
                    Houston County: the city and the county are both called
                    "Houston" and were otherwise indistinguishable here.
                  */}
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      hit.tier === 0
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                        : hit.tier === 2
                          ? 'bg-inset text-ink-muted'
                          : 'bg-blue-100 text-blue-800'
                    }`}
                  >
                    {hit.kind}
                  </span>
                </span>
                {hit.address ? (
                  <span className="block truncate text-xs text-ink-muted">
                    {hit.address}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
