import { createHash, timingSafeEqual } from 'node:crypto';
import { apiError, apiOk, serverError } from '@/lib/api';
import { getDb } from '@/lib/db';
import { runCleanup } from '@/lib/cleanup';

/**
 * Daily housekeeping, invoked by Vercel Cron (see vercel.json).
 *
 * Bearer-gated because an unauthenticated endpoint that performs bulk deletes is
 * a denial-of-service button. Vercel sends this header automatically when
 * CRON_SECRET is set in the project environment.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron] CRON_SECRET is not set; refusing to run cleanup');
    return apiError('SERVER_ERROR', 'Cleanup is not configured');
  }

  if (!authorized(request.headers.get('authorization'), secret)) {
    return apiError('FORBIDDEN', 'Not authorized');
  }

  try {
    const deleted = await runCleanup(getDb(), {
      deleteAbandonedTrips: process.env.CLEANUP_ABANDONED_TRIPS === 'true',
    });
    console.info('[cron] cleanup complete', deleted);
    return apiOk({ deleted });
  } catch (error) {
    return serverError('GET /api/cron/cleanup', error);
  }
}

function authorized(header: string | null, secret: string): boolean {
  // Hash both sides so the comparison is constant-time regardless of length.
  const provided = createHash('sha256')
    .update(header ?? '')
    .digest();
  const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(provided, expected);
}
