'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// MapLibre GL JS v5 ships named exports only — there is no default export.
// `Map` is aliased so it does not shadow the global Map constructor.
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  type GeoJSONSource,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useTheme } from './ThemeProvider';

export interface MapStop {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  stops: readonly MapStop[];
  /** Stitched trip line in [lng, lat] order. */
  geometry: readonly [number, number][];
  /**
   * Called when a selected marker is dragged to a new position. Omit to make
   * markers fixed — the read-only share page does.
   */
  onStopMoved?: (stopId: string, lat: number, lng: number) => void;
  /** Called when the map is right-clicked, to add a stop there. */
  onAddStopAt?: (lat: number, lng: number) => void;
  className?: string;
}

const ROUTE_SOURCE = 'trip-route';
const ROUTE_CASING_LAYER = 'trip-route-casing';
const ROUTE_LINE_LAYER = 'trip-route-line';

/**
 * OpenFreeMap styles, no API key of any kind. `bright` has the most road
 * contrast of the available styles, which suits a route map better than the
 * muted `liberty` default.
 */
const STYLES = {
  light: 'https://tiles.openfreemap.org/styles/bright',
  dark: 'https://tiles.openfreemap.org/styles/dark',
} as const;

/**
 * One override per theme, not a single one for both.
 *
 * A single NEXT_PUBLIC_MAP_STYLE_URL silently pinned the basemap to one style
 * and made the appearance setting unable to change it — the map stayed light
 * while the rest of the UI went dark.
 */
function styleUrlFor(theme: 'light' | 'dark'): string {
  const override =
    theme === 'dark'
      ? process.env.NEXT_PUBLIC_MAP_STYLE_URL_DARK
      : process.env.NEXT_PUBLIC_MAP_STYLE_URL_LIGHT;
  return override?.trim() || STYLES[theme];
}

/**
 * The casing is a wider line drawn underneath, which separates the route from
 * whatever it crosses. On a dark basemap the route also needs to be genuinely
 * bright, or it disappears into the terrain.
 */
const ROUTE_COLORS = {
  light: { line: '#1d4ed8', casing: '#ffffff' },
  dark: { line: '#7dd3fc', casing: '#0a1020' },
} as const;

const MARKER_BASE =
  'flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold ' +
  'text-white shadow-md transition-transform';

/** Unselected: a click target, not a drag handle. */
const MARKER_IDLE = `${MARKER_BASE} border-white bg-blue-600 cursor-pointer`;

/**
 * Selected: visibly larger with a ring, and the only marker that can be dragged.
 * The ring is the affordance — it is what tells you a drag will now move a stop.
 */
const MARKER_SELECTED =
  `${MARKER_BASE} border-white bg-amber-500 cursor-grab active:cursor-grabbing ` +
  'scale-125 ring-4 ring-amber-400/50';

type RouteData = {
  type: 'FeatureCollection';
  features: Array<{
    type: 'Feature';
    properties: Record<string, never>;
    geometry: { type: 'LineString'; coordinates: [number, number][] };
  }>;
};

/**
 * Always a FeatureCollection, never a bare LineString.
 *
 * The previous placeholder was a LineString with `coordinates: []`, which is
 * invalid GeoJSON (a LineString needs at least two positions). A
 * FeatureCollection with zero features is unambiguously valid, so the source can
 * always be created safely and simply holds nothing until there is a real route.
 */
function routeData(coordinates: readonly [number, number][]): RouteData {
  return {
    type: 'FeatureCollection',
    features:
      coordinates.length >= 2
        ? [
            {
              type: 'Feature',
              properties: {},
              geometry: { type: 'LineString', coordinates: [...coordinates] },
            },
          ]
        : [],
  };
}

/** Keeps the route under place labels so towns stay readable on top of it. */
function firstSymbolLayerId(map: MapLibreMap): string | undefined {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (layer.type === 'symbol') return layer.id;
  }
  return undefined;
}

/**
 * Idempotent: creates the source and both line layers if absent, updates the
 * data if present. Every path calls this, and the map's own `isStyleLoaded()` is
 * the single source of truth for timing.
 */
function ensureRoute(
  map: MapLibreMap,
  coordinates: readonly [number, number][],
  theme: 'light' | 'dark',
): void {
  const data = routeData(coordinates);
  const colors = ROUTE_COLORS[theme];

  const existing = map.getSource(ROUTE_SOURCE) as GeoJSONSource | undefined;
  if (existing) {
    existing.setData(data);
  } else {
    map.addSource(ROUTE_SOURCE, { type: 'geojson', data });
  }

  const beforeId = firstSymbolLayerId(map);

  if (!map.getLayer(ROUTE_CASING_LAYER)) {
    map.addLayer(
      {
        id: ROUTE_CASING_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': colors.casing,
          'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 5, 8, 7.5, 12, 10, 16, 14],
        },
      },
      beforeId,
    );
  } else {
    map.setPaintProperty(ROUTE_CASING_LAYER, 'line-color', colors.casing);
  }

  if (!map.getLayer(ROUTE_LINE_LAYER)) {
    map.addLayer(
      {
        id: ROUTE_LINE_LAYER,
        type: 'line',
        source: ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': colors.line,
          'line-width': ['interpolate', ['linear'], ['zoom'], 4, 2.5, 8, 4, 12, 6, 16, 9],
        },
      },
      beforeId,
    );
  } else {
    map.setPaintProperty(ROUTE_LINE_LAYER, 'line-color', colors.line);
  }
}

interface MarkerRecord {
  stopId: string;
  marker: Marker;
  el: HTMLDivElement;
}

/**
 * Applies the selected/idle appearance to one marker.
 *
 * Uses classList rather than assigning `className`. MapLibre adds its own
 * `maplibregl-marker` classes to the element *after* construction, and
 * overwriting className stripped them — the markers stayed visible but stopped
 * being MapLibre markers as far as the DOM was concerned.
 *
 * Kept at module scope because the React Compiler rejects mutating a value that
 * an effect also reads; going through an opaque helper keeps it satisfied.
 */
function paintMarker(record: MarkerRecord, name: string, isSelected: boolean): void {
  const next = isSelected ? MARKER_SELECTED : MARKER_IDLE;
  const previous = isSelected ? MARKER_IDLE : MARKER_SELECTED;
  record.el.classList.remove(...previous.split(' ').filter(Boolean));
  record.el.classList.add(...next.split(' ').filter(Boolean));
  record.el.title = isSelected
    ? `${name} — drag to move, Esc to cancel`
    : `${name} — click to move`;
}

export default function TripMap({
  stops,
  geometry,
  onStopMoved,
  onAddStopAt,
  className,
}: Props) {
  // Read from context rather than a prop, so the read-only share page — which is
  // a Server Component and cannot pass one — is themed too.
  const { resolved: theme } = useTheme();
  /**
   * The map lives in state, created by a callback ref rather than an effect.
   *
   * With the instance in a ref, every other effect had to guess when it existed —
   * and after React's Strict Mode remount in development the map was rebuilt
   * while the marker effect did not re-run (its dependencies had not changed), so
   * no markers appeared at all. It only ever worked by accident, because `stops`
   * used to be a new array on every render. Holding the instance in state makes
   * it a real dependency, so everything re-runs when the map is replaced.
   */
  const [mapInstance, setMapInstance] = useState<MapLibreMap | null>(null);
  const markers = useRef<MarkerRecord[]>([]);

  /**
   * Which marker is armed for dragging.
   *
   * Markers used to be draggable at all times, which made it far too easy to
   * nudge a stop while panning. Now a marker must be clicked first: selection is
   * a deliberate, visible step, and only the selected marker can be dragged.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Latest props for use inside map event handlers, which outlive the render
  // that registered them.
  const latest = useRef({ geometry, theme, stops, onStopMoved, onAddStopAt });
  useEffect(() => {
    latest.current = { geometry, theme, stops, onStopMoved, onAddStopAt };
  });

  const canDrag = Boolean(onStopMoved);
  const canAdd = Boolean(onAddStopAt);

  /**
   * Callback ref: creates the map when the container mounts and disposes it when
   * it unmounts. React 19 runs the returned function as the ref's cleanup.
   */
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;

    const instance = new MapLibreMap({
      container: node,
      style: styleUrlFor(latest.current.theme),
      center: [-104.99, 39.74],
      zoom: 4,
      attributionControl: { compact: true },
      // A trip map is read as a flat plan; rotation and pitch only get in the
      // way of dragging and make zooming feel unpredictable.
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      scrollZoom: { around: 'center' },
    });

    instance.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    instance.addControl(new ScaleControl({ maxWidth: 96, unit: 'metric' }), 'bottom-left');

    instance.on('error', (event) => {
      console.error('[map]', event.error?.message ?? event);
    });

    instance.on('styledata', () => {
      ensureRoute(instance, latest.current.geometry, latest.current.theme);
    });

    // Clicking empty map disarms the selected marker.
    instance.on('click', () => setSelectedId(null));

    // Right-click drops a new stop. The browser's own menu is suppressed on the
    // container so the gesture is usable.
    instance.on('contextmenu', (event) => {
      latest.current.onAddStopAt?.(event.lngLat.lat, event.lngLat.lng);
    });
    const suppressMenu = (event: MouseEvent) => event.preventDefault();
    node.addEventListener('contextmenu', suppressMenu);

    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __tripMap?: MapLibreMap }).__tripMap = instance;
    }

    setMapInstance(instance);

    return () => {
      node.removeEventListener('contextmenu', suppressMenu);
      markers.current.forEach((m) => m.marker.remove());
      markers.current = [];
      instance.remove();
      setMapInstance(null);
    };
  }, []);

  // Escape disarms the selection without touching the map.
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  // Swap the basemap when the appearance setting changes.
  useEffect(() => {
    if (!mapInstance) return;
    mapInstance.setStyle(styleUrlFor(theme));
    // Route layers are re-added by the `styledata` handler above.
  }, [mapInstance, theme]);

  // Push new geometry whenever it changes.
  useEffect(() => {
    if (!mapInstance) return;
    if (mapInstance.isStyleLoaded()) ensureRoute(mapInstance, geometry, theme);
  }, [mapInstance, geometry, theme]);

  /** Identity of the stop set — changes on add, remove and reorder only. */
  const fitKey = useMemo(() => stops.map((s) => s.id).join('|'), [stops]);

  /** Positions, so markers move when coordinates change without rebuilding. */
  const positionKey = useMemo(
    () => stops.map((s) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`).join('|'),
    [stops],
  );

  // Build markers when the stop set changes, or when the map is (re)created.
  useEffect(() => {
    const instance = mapInstance;
    if (!instance) return;

    markers.current.forEach((m) => m.marker.remove());
    markers.current = latest.current.stops.map((stop, index) => {
      const el = document.createElement('div');
      el.className = MARKER_IDLE;
      el.textContent = String(index + 1);
      el.title = stop.name;

      const marker = new Marker({ element: el, draggable: false })
        .setLngLat([stop.lng, stop.lat])
        .addTo(instance);

      if (canDrag) {
        // Click selects. stopPropagation keeps the map's own click — which
        // deselects — from immediately undoing it.
        el.addEventListener('click', (event) => {
          event.stopPropagation();
          setSelectedId((current) => (current === stop.id ? null : stop.id));
        });

        marker.on('dragend', () => {
          const { lat, lng } = marker.getLngLat();
          latest.current.onStopMoved?.(stop.id, lat, lng);
          // Disarm after a move, so a second stray drag cannot follow.
          setSelectedId(null);
        });
      }

      return { stopId: stop.id, marker, el };
    });
  }, [mapInstance, fitKey, canDrag]);

  // Move existing markers when coordinates change — no rebuild, so an in-flight
  // drag is never destroyed.
  useEffect(() => {
    for (const record of markers.current) {
      const stop = latest.current.stops.find((s) => s.id === record.stopId);
      if (stop) record.marker.setLngLat([stop.lng, stop.lat]);
    }
  }, [mapInstance, positionKey]);

  // Arm exactly one marker. setDraggable avoids rebuilding to change state.
  useEffect(() => {
    for (const record of markers.current) {
      const isSelected = record.stopId === selectedId;
      record.marker.setDraggable(canDrag && isSelected);
      const stop = latest.current.stops.find((s) => s.id === record.stopId);
      paintMarker(record, stop?.name ?? 'Stop', isSelected);
    }
  }, [mapInstance, selectedId, canDrag, fitKey]);

  /**
   * Auto-fit depends on `fitKey` ALONE.
   *
   * This is the bug behind "the map keeps re-zooming". `fitKey` was already
   * stable, but `stops` was also in this dependency array — and `stops` is a
   * fresh array on every parent render. So typing a note or moving a marker
   * re-ran the effect and re-fit the camera even though the stop set had not
   * changed. Coordinates are read from the ref instead, which is not a
   * dependency. One cause, several symptoms.
   */
  useEffect(() => {
    const instance = mapInstance;
    const current = latest.current.stops;
    if (!instance || current.length === 0) return;

    if (current.length === 1) {
      // fitBounds on a single point produces degenerate bounds and an absurd
      // zoom, so centre instead.
      instance.easeTo({
        center: [current[0].lng, current[0].lat],
        zoom: 11,
        duration: 600,
      });
      return;
    }

    const bounds = new LngLatBounds();
    for (const stop of current) bounds.extend([stop.lng, stop.lat]);

    instance.fitBounds(bounds, {
      // Extra bottom padding keeps the lowest stop clear of the attribution bar.
      padding: { top: 48, right: 48, bottom: 64, left: 48 },
      maxZoom: 15,
      duration: 700,
    });
  }, [mapInstance, fitKey]);

  const selectedName = useMemo(
    () => stops.find((s) => s.id === selectedId)?.name ?? null,
    [stops, selectedId],
  );

  const deselect = useCallback(() => setSelectedId(null), []);

  return (
    <div className={`relative ${className ?? ''}`}>
      {/*
        `h-full w-full`, NOT `absolute inset-0`: maplibre-gl.css sets
        `.maplibregl-map { position: relative }` on the container, which beats
        Tailwind's `absolute` and left `inset-0` doing nothing — the map
        collapsed to 56px tall. Explicit sizing is not overridden.
      */}
      <div ref={containerRef} className="h-full w-full" />

      {/* Hint chips. pointer-events-none so they never block the map. */}
      {canAdd && !selectedName ? (
        <div className="pointer-events-none absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[11px] font-medium text-white shadow">
          Right-click the map to add a stop · click a marker to move it
        </div>
      ) : null}

      {selectedName ? (
        <div className="absolute left-2 top-2 flex items-center gap-2 rounded-md bg-amber-500 px-2 py-1 text-[11px] font-semibold text-white shadow">
          <span>Drag “{selectedName}” to move it</span>
          <button
            type="button"
            onClick={deselect}
            className="rounded bg-black/20 px-1.5 py-0.5 font-medium hover:bg-black/30"
          >
            Cancel
          </button>
        </div>
      ) : null}
    </div>
  );
}
