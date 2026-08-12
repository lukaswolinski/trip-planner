@AGENTS.md

# Trip Planner

Plans long road trips and backpacking routes with **no practical stop limit**.
Google Maps caps a route at 10 stops; hosted routing APIs cap a single request at
~25 coordinates. Trips persist, have per-stop notes and night counts, per-leg and
total distance/time, and read-only share links.

**Stack:** Next.js 16 (App Router) · TypeScript strict · Postgres + Drizzle ·
Zod · @dnd-kit · MapLibre GL JS v5 · vitest.
Commands: `npm run dev | build | test | typecheck | lint | db:migrate`.

## Leg-chunking: the core architecture

A trip of N stops is **N−1 independent legs**, each cached in `route_legs` by
`(profile, from_lat, from_lng, to_lat, to_lng)` at 5dp. Runs of *consecutive*
uncached legs go out as one multi-coordinate request; each response's `legs[]` is
split back into individual rows.

This exists because no provider routes unlimited stops in one call. Consequences
worth preserving:

- **Totals are exact**, not approximate — summing consecutive legs equals what a
  single N-waypoint call would return. Measured: 39 cached legs reproduced a
  665 km corridor to within 0.9%.
- 60 stops = **1 request** (OSRM, 99-leg ceiling) or 3 (Mapbox, 24). Reopening a
  trip = **0**. Reordering re-fetches only the ~3 changed legs, in 2 requests —
  they aren't adjacent, and a routing request must be one contiguous path.
- `steps=true` is **required**, not decorative: both providers return geometry at
  route level, and per-leg geometry only exists as the concatenation of that
  leg's steps. Without it legs can't be cached independently.

`lib/routing/{legs,chunked-router,cache,summary}.ts` are pure and
dependency-injected — no DB, network, or env. That's why the whole differentiator
is testable with no credentials. Keep it that way.

## Flight legs: OSRM lies about unroutable pairs

A leg with no road becomes a **flight leg** — great-circle distance, `durationS`
0, a two-point straight line, drawn dashed — instead of failing the trip.

**Detection cannot rely on the error code.** Verified live: Paris → New York
returns `code: "Ok"` and a confident 1777 km, because OSRM snaps each coordinate
to the nearest node *reachable from the origin* and had quietly relocated New
York to a road near Lisbon, 5391 km away. The signal is
`waypoints[].location`: a snap beyond `MAX_SNAP_DISPLACEMENT_M` (200 km) means
the answer is fiction. Genuine routes snap 0.0–0.1 km.

OSRM *also* returns `NoRoute` for some multi-point chains without saying which
pair failed, so `createChunkedRouter` bisects the chunk to isolate it
(~2·log₂(n) requests, only on that path). Flight verdicts are cached in
`route_legs.is_flight`, so an ocean is discovered once, not per summary.

Totals stay separate: `totalDistanceM`/`totalDurationS` are ground travel only,
with `flightLegCount`/`totalFlightDistanceM` alongside. Geometry is
`roadSegments[]` + `flightSegments[]`, never one stitched line — stitching
across the gap draws a road that does not exist.

## Provider interface

Routing and geocoding are chosen **independently** via `ROUTING_PROVIDER`
(`osrm` default | `mapbox`) and `GEOCODING_PROVIDER` (`photon` default |
`mapbox`). Both defaults need no account.

Each provider splits into a **pure dialect** (URL shape + request ceiling,
directly testable) and a **`server-only` transport** (holds credentials). Adding
a provider means adding those two, not touching the core.

- Selection logic lives in `provider-config.ts` (pure); factories in
  `provider.ts` (`server-only`).
- **Cache TTL is provider-dependent.** Mapbox's terms cap retention of routing
  results at 30 days, so `cacheTtlDays()` clamps to it. Under OSRM/OSM (ODbL)
  there's no cap, so it's purely a freshness knob.
- Mapbox geocoding requires `permanent=true` (we store coordinates); Photon has
  no such restriction.

## ⚠️ maplibre-gl is pinned to v5 — do not upgrade

**v6 breaks the map silently under Turbopack.** It ships MapLibre's tile-parsing
Web Worker as a separate dist file that Turbopack doesn't serve, so the worker
never starts and **no error is emitted**. Symptom is misleading: the raster
hillshade still draws (main thread), so you get a "flat" map with no roads, no
labels, and no route line — while the GeoJSON source holds perfectly good data.

If upgrading, verify `page.workers().length === 1` in a real browser. Tests will
not catch this; only driving the browser will.

## ⚠️ OSRM/Photon demo servers are not productionable

Default routing is `routing.openstreetmap.de`, geocoding `photon.komoot.io`:
**non-commercial use only, ~1 request/second, no uptime guarantee, must not sit
behind a paywall, access withdrawable without notice.** Self-host
`osrm-backend` and set `OSRM_BASE_URL` before real users. OSM attribution is
required.

Use `routing.openstreetmap.de`, **never `router.project-osrm.org`** — the latter
ignores the profile slug and returns car results for `foot`/`bike` alike
(verified: byte-identical responses), which would label driving times as walking.
A dialect that can't route a profile must throw, never substitute.

The upstream throttle in `lib/routing/throttle.ts` paces **per Node process**, so
on multi-instance serverless the real rate is per-instance × warm instances. Fine
given the cache; not a hard global guarantee.

## Gotchas that cost real time

- **Next 16:** it's `proxy.ts`, not `middleware.ts`, exporting `proxy`.
  `cookies()`, `params`, `searchParams` are **async-only**.
- **Never import a constant from a `'use client'` module into a Server
  Component** — Next replaces it with a client-reference stub. Doing this with
  the theme storage key interpolated a stub's *source text* into an inline
  script and produced a syntax error on every page load. Shared constants go in
  a neutral module (`lib/theme.ts`).
- **Session cleanup:** `trips.session_id` is `ON DELETE SET NULL` and a CHECK
  requires a trip to have a session or a user — so deleting a session that still
  owns an unclaimed trip would null its last owner. Cleanup skips those; claimed
  trips survive with `session_id` nulled.
- **Rate limits key on session AND IP** (a session is just a cookie). IPv6
  buckets by /64; keys store a salted HMAC, never a raw IP.
- **Drizzle renders columns unqualified inside a `sql` template used in a
  selection.** A correlated subquery written that way became
  `from "stops" where "trip_id" = "id"`, comparing `stops.trip_id` to `stops.id`,
  so the trip list silently reported 0 stops for every trip. Prefer a
  `leftJoin` + `groupBy`, or write the identifiers out; check `.toSQL()` when a
  raw aggregate looks wrong.
- **Anything rendered during SSR must not touch `window`.** `ShareDialog` opens
  on first paint when returning from a magic link (`?share=1`), and reading
  `window.location.origin` in a `useState` initializer 500'd that whole route.
  Absolute URLs come from `appUrl()` on the server and are passed down.
- **Route fixtures must come from a real route's geometry.** Arbitrary
  coordinates land off-road and the car profile correctly snaps to unpaved
  tracks — synthetic fixtures averaged 23 km/h versus 83 km/h on the highway.
- **`map.isStyleLoaded()` is not a readiness gate.** It stays false while
  sprites and glyphs load, long after `addSource` would succeed, and
  `styledata` may already have fired for the last time — so geometry arriving
  in that window was dropped and never retried, leaving no route and no error.
  Defer to `map.once('idle', …)` instead of discarding.
- **A MapLibre GeoJSON source's `_data` is `{ geojson: FeatureCollection }`.**
  `source._data.features` is `undefined`; use `source.serialize().data`. A
  browser check reading the wrong one reports 0 features for a working map.
- Theme: `data-theme` on `<html>` drives every Tailwind `dark:` class via a
  `@custom-variant` in `globals.css`, plus the map basemap.
- 18 of 126 tests need `DATABASE_URL` and **a dedicated test database** —
  cleanup tests delete old rows database-wide.
