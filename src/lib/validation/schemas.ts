/**
 * Every request body and query string is parsed here before it reaches a
 * database call. One schema per endpoint, types inferred, no hand-written
 * guards drifting out of sync.
 *
 * Schemas are built per tier so that stop caps come from getLimits() rather
 * than being hardcoded at each call site — see lib/limits.ts.
 */

import { z } from 'zod';
import { getLimits, TRAVEL_PROFILES, type Limits, type Tier } from '@/lib/limits';

/**
 * Drops C0/C1 control characters — including NUL, which Postgres `text` cannot
 * store and which is a classic way to smuggle a terminator past a naive check.
 *
 * Written as a code-point scan rather than a character-class regex so that no
 * control character ever appears literally in this source file.
 */
function stripControlChars(value: string, keepNewlines: boolean): string {
  const LF = 10;
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === LF) {
      if (keepNewlines) out += char;
      continue;
    }
    const isC0 = code < 32;
    const isDelOrC1 = code >= 127 && code <= 159;
    if (isC0 || isDelOrC1) continue;
    out += char;
  }
  return out;
}

/**
 * Multi-line text: normalises CRLF and bare CR to LF, then strips the remaining
 * control characters.
 *
 * Notes are stored raw and rendered as React text nodes (escaped by default).
 * We deliberately do not strip HTML, because there is no HTML rendering path to
 * protect — introducing one later is what would need review.
 */
function cleanText(max: number) {
  return z
    .string()
    .max(max)
    .transform((value) => stripControlChars(value.replace(/\r\n?/g, '\n'), true));
}

/**
 * Single-line fields lose newlines too, so a stop name cannot carry line breaks
 * or terminal escape sequences into logs and the UI.
 */
function cleanLine(max: number) {
  return z
    .string()
    .max(max)
    .transform((value) => stripControlChars(value, false).trim());
}

const profile = z.enum(TRAVEL_PROFILES);

const latitude = z.number().finite().min(-90).max(90);
const longitude = z.number().finite().min(-180).max(180);

function build(limits: Limits) {
  const title = cleanLine(limits.maxTitleChars).pipe(z.string().min(1));

  const createTrip = z.object({
    title: title.optional(),
    defaultProfile: profile.optional(),
  });

  const patchTrip = z.object({
    title: title.optional(),
    defaultProfile: profile.optional(),
    /** Pin to the top of the trip list. Stored as a timestamp server-side. */
    pinned: z.boolean().optional(),
    /** Optimistic concurrency: the version the client last read. */
    version: z.number().int().min(0),
  });

  /**
   * Minutes from midnight. `nullable` is meaningful here — null clears a time,
   * which is different from omitting the field and leaving it untouched.
   */
  const startMinutes = z.number().int().min(0).max(1439).nullable();

  const createItineraryItem = z.object({
    title: cleanLine(200).pipe(z.string().min(1)),
    notes: cleanText(2000).nullish(),
    startMinutes: startMinutes.optional(),
  });

  const patchItineraryItem = z
    .object({
      title: cleanLine(200).pipe(z.string().min(1)).optional(),
      notes: cleanText(2000).nullish(),
      startMinutes: startMinutes.optional(),
    })
    // An empty PATCH is a client bug, not a no-op worth accepting silently.
    .refine((value) => Object.keys(value).length > 0, {
      message: 'No fields to update',
    });

  const reorderItinerary = z.object({
    orderedIds: z.array(z.uuid()).min(1).max(500),
  });

  const createStop = z.object({
    name: cleanLine(200).pipe(z.string().min(1)),
    address: cleanLine(300).nullish(),
    lat: latitude,
    lng: longitude,
    notes: cleanText(limits.maxNotesChars).nullish(),
    days: z.number().int().min(0).max(365).optional(),
    profileToNext: profile.nullish(),
    /** Insert at this index; appended to the end when omitted. */
    position: z.number().int().min(0).max(limits.hardMaxStops).optional(),
  });

  const patchStop = z
    .object({
      name: cleanLine(200).pipe(z.string().min(1)).optional(),
      address: cleanLine(300).nullish(),
      notes: cleanText(limits.maxNotesChars).nullish(),
      days: z.number().int().min(0).max(365).optional(),
      profileToNext: profile.nullish(),
      // Repositioning by dragging the map marker. Validated exactly like the
      // coordinates on creation — same ranges, same rejection of NaN/Infinity.
      lat: latitude.optional(),
      lng: longitude.optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'No fields to update',
    });

  const reorder = z.object({
    /**
     * The complete ordered list. The handler additionally verifies this is a
     * permutation of the trip's own stops, which is what stops a caller
     * splicing someone else's stop id into their trip.
     */
    stopIds: z.array(z.uuid()).min(1).max(limits.hardMaxStops),
  });

  const geocodeQuery = z.object({
    q: cleanLine(200).pipe(z.string().min(2)),
    lat: latitude.optional(),
    lng: longitude.optional(),
  });

  const authRequest = z.object({
    email: z
      .string()
      .max(320)
      .transform((value) => value.trim().toLowerCase())
      .pipe(z.email()),
    /** Trip the user was trying to share when the email gate appeared. */
    tripId: z.uuid().optional(),
  });

  return {
    createTrip,
    patchTrip,
    createItineraryItem,
    patchItineraryItem,
    reorderItinerary,
    createStop,
    patchStop,
    reorder,
    geocodeQuery,
    authRequest,
  };
}

export type Schemas = ReturnType<typeof build>;

const cache = new Map<Tier, Schemas>();

export function schemasFor(tier: Tier): Schemas {
  let schemas = cache.get(tier);
  if (!schemas) {
    schemas = build(getLimits(tier));
    cache.set(tier, schemas);
  }
  return schemas;
}

export const uuidSchema = z.uuid();
