import { NextResponse } from 'next/server';
import { getSessionContext } from '@/lib/auth/session';
import { verifyMagicToken } from '@/lib/auth/magic-link';
import { getDb } from '@/lib/db';
import { appUrl } from '@/lib/app-url';
import { uuidSchema } from '@/lib/validation/schemas';

/**
 * Consumes a magic link, claims the requesting session's trips, and redirects
 * back into the app.
 *
 * Redirect targets are built from APP_URL and a validated uuid — never from
 * caller-supplied strings — so this cannot be turned into an open redirect.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const tripParam = url.searchParams.get('trip');
  const tripId = tripParam && uuidSchema.safeParse(tripParam).success ? tripParam : null;

  const base = appUrl();

  if (!token) {
    return NextResponse.redirect(`${base}/?signin=invalid`);
  }

  try {
    const db = getDb();
    const context = await getSessionContext();
    const result = await verifyMagicToken(db, token, context.sessionId);

    if (!result) {
      // Expired, already used, or never existed — all the same to the visitor.
      return NextResponse.redirect(`${base}/?signin=expired`);
    }

    const destination = tripId
      ? `${base}/trips/${tripId}?signin=ok&share=1`
      : `${base}/?signin=ok`;
    return NextResponse.redirect(destination);
  } catch (error) {
    console.error('[api] GET /api/auth/verify', error);
    return NextResponse.redirect(`${base}/?signin=error`);
  }
}
