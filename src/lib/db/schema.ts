import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  doublePrecision,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Emails are stored pre-lowercased by the application rather than using the
 * `citext` type, which would require a CREATE EXTENSION and makes the schema
 * less portable. `normalizeEmail()` in lib/auth/magic-link.ts is the only place
 * that writes this column.
 */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    /**
     * Added before there is any data, because adding a column to a populated
     * table is a migration with a default and a possible lock. Nothing branches
     * on it yet — see getLimits() in lib/limits.ts.
     */
    tier: text('tier').notNull().default('free'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_key').on(t.email),
    check('users_tier_check', sql`${t.tier} in ('free', 'pro')`),
  ],
);

/**
 * One row per browser that has ever loaded the app. The signed cookie carries
 * `id`. `user_id` is null until the visitor claims their trips with an email.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('sessions_user_id_idx').on(t.userId),
    // Partial index supporting the cleanup sweep, which only ever targets
    // anonymous sessions. Without it the nightly delete becomes a table scan
    // exactly when the table is big enough for that to hurt.
    index('sessions_anon_last_seen_idx').on(t.lastSeenAt).where(sql`user_id is null`),
  ],
);

export const trips = pgTable(
  'trips',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /**
     * Nullable with ON DELETE SET NULL on purpose. Session cleanup must not be
     * able to delete a trip belonging to someone who signed up — a claimed trip
     * is owned by `user_id` and survives its creating session's removal.
     */
    sessionId: uuid('session_id').references(() => sessions.id, { onDelete: 'set null' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('Untitled trip'),
    /** Null until shared. 22-char base64url of 16 random bytes. */
    shareSlug: text('share_slug'),
    sharedAt: timestamp('shared_at', { withTimezone: true }),
    defaultProfile: text('default_profile').notNull().default('driving'),
    /** Optimistic concurrency: a stale writer gets a 409 instead of clobbering. */
    version: integer('version').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('trips_share_slug_key').on(t.shareSlug),
    index('trips_session_id_idx').on(t.sessionId),
    index('trips_user_id_idx').on(t.userId),
    index('trips_updated_at_idx').on(t.updatedAt),
    // A trip must always be reachable by someone.
    check(
      'trips_owner_check',
      sql`${t.sessionId} is not null or ${t.userId} is not null`,
    ),
    check(
      'trips_default_profile_check',
      sql`${t.defaultProfile} in ('driving', 'walking')`,
    ),
  ],
);

export const stops = pgTable(
  'stops',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tripId: uuid('trip_id')
      .notNull()
      .references(() => trips.id, { onDelete: 'cascade' }),
    /** 0-based and contiguous. Reorder renumbers every row in one statement. */
    position: integer('position').notNull(),
    name: text('name').notNull(),
    address: text('address'),
    lng: doublePrecision('lng').notNull(),
    lat: doublePrecision('lat').notNull(),
    notes: text('notes'),
    /** Nights spent here. Drives the itinerary and Phase 2 auto-segmenting. */
    days: integer('days').notNull().default(0),
    /**
     * Travel mode from this stop to the next. Null means "use the trip
     * default". Per-leg profiles are what make "drive to the trailhead, then
     * walk for three days" work.
     */
    profileToNext: text('profile_to_next'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('stops_trip_id_position_idx').on(t.tripId, t.position),
    check('stops_days_check', sql`${t.days} >= 0`),
    check('stops_position_check', sql`${t.position} >= 0`),
    check('stops_lat_check', sql`${t.lat} between -90 and 90`),
    check('stops_lng_check', sql`${t.lng} between -180 and 180`),
    check(
      'stops_profile_to_next_check',
      sql`${t.profileToNext} is null or ${t.profileToNext} in ('driving', 'walking')`,
    ),
  ],
);

/**
 * Provider-response cache, shared across all trips and users: two people
 * routing Denver -> Moab hit the same row.
 *
 * Deliberately NOT foreign-keyed to trips — it must survive trip deletion, and
 * keeping all Mapbox-derived data in one table means the 30-day retention
 * obligation has exactly one place to be enforced.
 */
export const routeLegs = pgTable(
  'route_legs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    profile: text('profile').notNull(),
    fromLat: numeric('from_lat', { precision: 9, scale: 5 }).notNull(),
    fromLng: numeric('from_lng', { precision: 9, scale: 5 }).notNull(),
    toLat: numeric('to_lat', { precision: 9, scale: 5 }).notNull(),
    toLng: numeric('to_lng', { precision: 9, scale: 5 }).notNull(),
    distanceM: integer('distance_m').notNull(),
    durationS: integer('duration_s').notNull(),
    /** Encoded polyline, precision 6. Compact enough for a 250-stop trip. */
    geometry: text('geometry').notNull(),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('route_legs_key').on(
      t.profile,
      t.fromLat,
      t.fromLng,
      t.toLat,
      t.toLng,
    ),
    index('route_legs_fetched_at_idx').on(t.fetchedAt),
  ],
);

export const magicTokens = pgTable(
  'magic_tokens',
  {
    /** sha256 of the token that was emailed. The raw token is never stored. */
    tokenHash: text('token_hash').primaryKey(),
    email: text('email').notNull(),
    /** The anonymous session whose trips this token will claim. */
    sessionId: uuid('session_id')
      .notNull()
      .references(() => sessions.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('magic_tokens_expires_at_idx').on(t.expiresAt)],
);

/**
 * Fixed-window counters. Postgres-backed because Vercel gives each Lambda its
 * own memory, so an in-process counter would reset unpredictably and enforce
 * nothing.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    /** e.g. `route:sess:<uuid>` or `route:ip:<hmac>` — never a raw IP. */
    key: text('key').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index('rate_limits_window_start_idx').on(t.windowStart),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type Trip = typeof trips.$inferSelect;
export type Stop = typeof stops.$inferSelect;
export type RouteLeg = typeof routeLegs.$inferSelect;
