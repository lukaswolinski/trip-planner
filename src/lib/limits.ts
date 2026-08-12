/**
 * Every tunable number in the app lives here.
 *
 * The point of the indirection is Phase 2: adding a paid tier should mean
 * editing one object, not hunting for hardcoded numbers at a dozen call sites.
 * Both tiers deliberately return the same values today.
 */

/**
 * How long routing results are retained.
 *
 * Under **Mapbox** this is a contractual ceiling: their Product Terms permit
 * caching Directions/Matrix/Optimization results for up to but no more than 30
 * days, and `cacheTtlDays()` in lib/routing/provider.ts clamps to it so an env
 * var cannot breach the terms.
 *
 * Under **OSRM/OSM** there is no equivalent restriction — ODbL does not cap
 * retention — so the TTL is purely a freshness choice: drive durations drift as
 * speed limits and roadworks change, and refetching monthly keeps estimates
 * honest. Tune it freely on that path.
 */
export const CACHE_TTL_DAYS = 30;

/** Mapbox Directions accepts 2..25 coordinates per request. */
export const MAPBOX_MAX_COORDS_PER_REQUEST = 25;

/**
 * 25 coordinates describe at most 24 consecutive legs. This is the Mapbox
 * ceiling; the OSRM provider sets its own (higher) value — see
 * lib/routing/providers/osrm.ts.
 */
export const MAX_LEGS_PER_REQUEST = MAPBOX_MAX_COORDS_PER_REQUEST - 1;

/** Coordinates are rounded to 5dp (~1.1 m) to form cache keys. */
export const COORD_PRECISION = 5;

/**
 * How far a routing provider may move a coordinate when snapping it to the road
 * network before we stop believing the result.
 *
 * This is the load-bearing number for flight-leg detection, and it exists
 * because OSRM does not report "no route" for a transatlantic leg. Measured
 * against the live demo server:
 *
 * | request                | snap displacement | verdict          |
 * | ---------------------- | ----------------- | ---------------- |
 * | Paris → Berlin         |   0.0–0.1 km      | genuine route    |
 * | New York → Boston      |   0.1 km          | genuine route    |
 * | Paris → **New York**   | **5391 km**       | fiction          |
 *
 * That last one returned `code: "Ok"` and a confident 1777 km, because OSRM
 * prefers a snap candidate reachable from the origin — so it silently
 * substituted a road near Lisbon for New York. Trusting the response code alone
 * would show a plausible wrong number, which is worse than an error.
 *
 * 200 km is far beyond any legitimate snap (a stop on a small island or in a
 * pedestrian zone moves single-digit kilometres at most) and far below the
 * thousands of kilometres a continental substitution produces, so there is no
 * realistic case sitting near the boundary.
 */
export const MAX_SNAP_DISPLACEMENT_M = 200_000;

export const TIERS = ['free', 'pro'] as const;
export type Tier = (typeof TIERS)[number];

export function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && (TIERS as readonly string[]).includes(value);
}

export type TravelProfile = 'driving' | 'walking';
export const TRAVEL_PROFILES = ['driving', 'walking'] as const;

export interface RateRule {
  /** Max requests allowed inside the window. */
  limit: number;
  /** Fixed window length in seconds. */
  windowSeconds: number;
}

export interface Limits {
  /** Soft cap — UI warns, request still succeeds. */
  maxStops: number;
  /** Hard cap — Zod rejects beyond this. Bounds cost and payload size. */
  hardMaxStops: number;
  /** Phase 2: how many stops may be optimized at once (Matrix caps at 25). */
  optimizeWindow: number;
  maxNotesChars: number;
  maxTitleChars: number;
  rate: {
    routeSummary: { session: RateRule; ip: RateRule };
    geocode: { session: RateRule; ip: RateRule };
    writes: { session: RateRule; ip: RateRule };
    /** Public share page recomputing expired legs — no session to key on. */
    sharePageRecompute: { ip: RateRule };
    /** Magic-link requests, limited per IP and per email address. */
    authRequest: { ip: RateRule; email: RateRule };
  };
}

const MINUTE = 60;
const HOUR = 3600;

/**
 * IP buckets are intentionally looser than session buckets: cafés,
 * universities, mobile networks and CGNAT put many legitimate users behind one
 * address. The session bucket catches a runaway client; the IP bucket catches
 * someone clearing cookies to mint fresh sessions.
 */
const FREE: Limits = {
  maxStops: 250,
  hardMaxStops: 500,
  optimizeWindow: 25,
  maxNotesChars: 5000,
  maxTitleChars: 120,
  rate: {
    routeSummary: {
      session: { limit: 30, windowSeconds: MINUTE },
      ip: { limit: 100, windowSeconds: MINUTE },
    },
    geocode: {
      session: { limit: 60, windowSeconds: MINUTE },
      ip: { limit: 200, windowSeconds: MINUTE },
    },
    writes: {
      session: { limit: 300, windowSeconds: MINUTE },
      ip: { limit: 600, windowSeconds: MINUTE },
    },
    sharePageRecompute: {
      ip: { limit: 10, windowSeconds: MINUTE },
    },
    authRequest: {
      ip: { limit: 10, windowSeconds: HOUR },
      email: { limit: 5, windowSeconds: HOUR },
    },
  },
};

const PRO: Limits = FREE;

export function getLimits(tier: Tier | null | undefined): Limits {
  return tier === 'pro' ? PRO : FREE;
}

/** Cleanup retention windows, in days. Used by the cron sweep. */
export const RETENTION = {
  rateLimitsHours: 2,
  magicTokensDays: 1,
  routeLegsDays: CACHE_TTL_DAYS,
  anonymousSessionDays: 90,
  abandonedAnonymousTripDays: 180,
} as const;

/** Batch size for cleanup deletes, so no statement holds a long lock. */
export const CLEANUP_BATCH = 5000;
