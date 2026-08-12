# Trip Planner — unlimited stops

Plan long road trips and backpacking routes with as many stops as you like.
Google Maps caps a route at 10 stops; every hosted routing API caps a single
request at some coordinate ceiling. This app has no practical stop limit because
it models a trip as **independent legs** rather than one giant routing request.

**Runs with no map account at all.** Routing, geocoding and tiles all default to
keyless providers: OSRM, Photon and OpenFreeMap.

## How unlimited stops works

A trip of N stops is N−1 legs. Each leg is cached by
`(profile, from_lat, from_lng, to_lat, to_lng)` at 5-decimal precision, and runs
of *consecutive* uncached legs go out as single multi-coordinate requests.

Measured against the live OSRM demo server with a 40-stop Denver → Green River
trip:

| Action | Provider requests | Observed |
| --- | --- | --- |
| Build the trip (39 legs) | **1** | 1.4 s |
| Reopen it, all legs cached | **0** | 0.7 s |
| Drag one stop to a new position | **2**, covering 3 legs | 1.9 s |
| Reopen after the TTL expires | full refetch | — |

Totals are exact, not approximate. Summing those 39 independently-cached legs
gave **659 km at 84 km/h**, against **665 km at 83 km/h** for the same corridor
routed in one shot — the 0.9% gap is only stops snapping to slightly different
road vertices.

A reorder costs two requests rather than one because the three changed legs are
not adjacent to each other — the gap left behind closes into one leg, and the
insertion point splits another into two — and a routing request must describe one
contiguous path.

## Setup

Requires Node 20.9+ (built and tested on 24.19) and a Postgres database.

```bash
npm install
cp .env.example .env.local   # fill in DATABASE_URL and the three secrets
npm run db:migrate
npm run dev
```

Only four values are required: `DATABASE_URL`, `SESSION_SECRET`,
`RATE_LIMIT_PEPPER` and `CRON_SECRET`. Everything else has a working keyless
default.

### Email (magic links) is optional in development

With `RESEND_API_KEY` and `MAIL_FROM` unset, no email is sent and the UI **says
so**, offering the sign-in link directly on screen (development only). It does
not claim to have sent an email it did not send.

To enable real email you need a [Resend](https://resend.com) account — free tier
is ample here — plus a verified sender. Either verify your own domain, or use
Resend's `onboarding@resend.dev` sender, which can only deliver to the address
that owns the account. Then set:

```
RESEND_API_KEY=re_...
MAIL_FROM=you@yourdomain.com
```

In production a missing provider is a hard error rather than a degraded mode, so
sign-in cannot silently do nothing.

### Appearance

Settings (gear icon, top right) has one section: **Appearance** — System, Light or
Dark. It drives the `data-theme` attribute on `<html>`, which every Tailwind
`dark:` class keys off via a `@custom-variant` in `globals.css`, plus the CSS
variables and the map basemap. The choice is saved in `localStorage` and applied
by a small inline script before first paint, so there is no flash of the wrong
theme.

## Providers

Routing and geocoding are selected independently by env var, and both default to
the keyless option. See [`.env.example`](.env.example) for every setting.

| Concern | Default (keyless) | Alternative |
| --- | --- | --- |
| Routing | `ROUTING_PROVIDER=osrm` | `mapbox` (needs `MAPBOX_SECRET_TOKEN`) |
| Geocoding | `GEOCODING_PROVIDER=photon` | `mapbox` (needs permanent geocoding enabled) |
| Tiles | OpenFreeMap `bright` / `dark` | `NEXT_PUBLIC_MAP_STYLE_URL_LIGHT` / `_DARK` |

### ⚠️ maplibre-gl is pinned to v5 on purpose — do not upgrade to v6 blindly

**v6 breaks the map silently under Next.js/Turbopack.** MapLibre parses vector
tiles in a Web Worker. v6 ships that worker as a *separate* dist file
(`maplibre-gl-worker.mjs`), which Turbopack does not serve, so the worker never
starts — and MapLibre emits **no error at all**.

The symptoms are indirect and easy to misdiagnose: the raster hillshade layer
still renders (main thread), so you get a map that looks "flat and washed out",
with **no roads, no labels, and no route line**. Verified with a browser driver:
`page.workers().length === 0`, `isStyleLoaded() === false`, and
`queryRenderedFeatures().length === 0` while the GeoJSON source contained a
perfectly good 7,643-point LineString.

v5 inlines the worker as a blob and works in both `next dev` and `next build`
(confirmed: 1 worker, `tilesLoaded: true`, route rendered). If you do upgrade,
verify `page.workers().length === 1` in a real browser — a passing test suite
will not catch this.

### Why `routing.openstreetmap.de` and not `router.project-osrm.org`

Verified against the live services, not assumed: **`router.project-osrm.org`
ignores the profile slug.** Requesting `/route/v1/driving`, `/foot`, `/bike`,
`/walking`, `/car` and `/cycling` for the same three coordinates all returned
byte-identical results (110487 m / 4846 s) — it serves the car profile and the
slug is decorative. Using it for walking would silently return driving times
labelled as walking.

`routing.openstreetmap.de` runs a separate `osrm-routed` per profile behind path
prefixes and genuinely honours them:

| endpoint | distance | duration |
| --- | --- | --- |
| `/routed-car/route/v1/driving/…` | 110487 m | 4846 s |
| `/routed-foot/route/v1/foot/…` | 124165 m | 99517 s |
| `/routed-bike/route/v1/bike/…` | 128229 m | 23450 s |

A dialect that cannot route a profile **throws** rather than substituting one, so
this class of mistake cannot happen silently.

### ⚠️ The demo servers are not productionable

They are for reasonable, **non-commercial** use at no more than ~1 request per
second, with no uptime or latency guarantee, must not sit behind a paywall, and
access may be withdrawn at any time without reason. Photon and Nominatim carry
similar courtesy limits. Before putting this in front of real users, self-host
`osrm-backend` (a continent extract needs roughly 8–16 GB RAM) and set
`OSRM_BASE_URL`. OSM attribution is required and MapLibre adds it automatically.

Note also that the upstream throttle in
[`src/lib/routing/throttle.ts`](src/lib/routing/throttle.ts) paces requests
**within one Node process**. On multi-instance serverless the effective rate is
per-instance times warm instances. The per-leg cache makes calls rare enough that
this is fine for personal use, but a shared leased token would be needed for a
hard global guarantee.

## Commands

```bash
npm run dev          # dev server (Turbopack)
npm run build        # production build
npm test             # vitest
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run db:generate  # regenerate migration from schema changes
npm run db:migrate   # apply migrations
npm run db:studio    # browse the database
```

## Tests

`npm test` runs **126 tests**. Most need no credentials at all — the HTTP layer
is injected and faked, so the load-bearing chunking, reorder-delta, TTL and
dialect tests run offline.

The chunking guarantees are checked against **both** provider shapes: a 60-stop
trip costs 3 requests at Mapbox's 24-leg ceiling and 1 request at OSRM's 99-leg
ceiling.

18 of those tests are database-backed (authorization isolation, reorder
integrity, rate-limit buckets, cleanup safety) and skip unless `DATABASE_URL` is
set. To run them, point it at a **dedicated test database** — the cleanup tests
call `runCleanup()`, which deletes old rows across the whole database — and run
`npm run db:migrate` first.

## Architecture notes

- **The routing core is provider-neutral.**
  [`chunked-router.ts`](src/lib/routing/chunked-router.ts) does the chunking and
  response splitting; a `RouteDialect` supplies the URL shape and per-request
  ceiling; a transport performs the HTTP call and attaches any credentials. Each
  provider is split into a **pure dialect** (directly testable) and a
  **`server-only` transport** that holds secrets.
  Mapbox Directions v5 is itself derived from OSRM's HTTP API, so the shared
  parsing is genuine rather than a lowest common denominator: both return
  `code: "Ok"`, `routes[0].legs[]`, and per-leg `steps[].geometry`.
- **`steps=true` is required, not decorative:** both providers return geometry at
  the route level, and the only per-leg geometry available is the concatenation
  of that leg's steps. Without it, legs could not be cached independently.
- **Retention differs by provider.** Mapbox's Product Terms cap caching of
  routing results at 30 days, so `cacheTtlDays()` clamps to it and an env var
  cannot breach the terms. Under OSRM/OSM (ODbL) there is no retention cap, so
  the TTL is purely a freshness choice. Photon likewise has no
  temporary-vs-permanent restriction, so storing coordinates in `stops` is fine.
- **Rate limits key on session *and* IP**, and a request is denied if either
  bucket is exhausted. A session is just a cookie, so a session-only limit is a
  speed bump. IPv6 is bucketed by /64; IP buckets are deliberately looser than
  session buckets because cafés and mobile networks share addresses. Keys hold a
  salted HMAC of the address, never the address.
- **`proxy.ts`, not `middleware.ts`** — Next 16 renamed the convention. It only
  mints the signed session cookie; the `sessions` row is created lazily, so asset
  and bot traffic never writes to Postgres.
- **Share links** are 22-char base64url from 16 random bytes. The share page is a
  Server Component with no editor bundle, and no code path writes to a trip
  identified by its slug. Expired legs on a public page are recomputed behind an
  IP limit and written back, so a viral link costs about one recompute per cache
  lifetime rather than one per visitor.
- **Cleanup** ([`cleanup.ts`](src/lib/cleanup.ts), daily via `vercel.json`) only
  deletes an anonymous session once no trip references it: `trips.session_id` is
  `ON DELETE SET NULL` and a CHECK requires every trip to have a session or a
  user, so deleting a session that still owns an unclaimed trip would null its
  last owner. A *claimed* trip survives with `session_id` nulled. Deleting
  abandoned anonymous trips is the one rule that destroys user data, so it stays
  behind `CLEANUP_ABANDONED_TRIPS=false`.

## Known limits worth knowing before Phase 2

- **Google Maps export** must chunk at **3 waypoints per link** (5 stops), not 9:
  the Maps URLs spec allows 9 only on desktop and 3 on mobile browsers, and these
  links get opened on phones.
- **Apple Maps cannot accept waypoints via URL at all** — only `saddr`/`daddr`.
  Multi-stop `maps.apple/r/…` links are app-generated and not constructible by
  third parties, so "chunked links" would mean one link per leg. Offer GPX/KML
  export instead.
- **Optimization caps** are provider-specific. Mapbox Optimization v1 takes 12
  coordinates and Matrix takes 25 (10 for `driving-traffic`); self-hosted OSRM's
  `/table` ceiling is a launch flag you choose, which removes that constraint.
  Either way, optimize bounded windows rather than a whole trip.
- Durations are typical-conditions estimates, not live traffic, and the UI labels
  them with `≈`.
- **Fixture warning for anyone writing route tests:** arbitrary coordinates are
  not a valid fixture. A synthetic diagonal across Colorado and Utah averaged
  23 km/h because the car profile correctly snapped to unpaved tracks, and
  straight-line interpolation between real cities was no better (1212 km of
  detours versus 665 km along the highway). Derive fixture stops from a route the
  router itself returned.
