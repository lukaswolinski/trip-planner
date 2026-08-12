/**
 * Mints the anonymous session cookie on first load.
 *
 * In Next 16 this file is `proxy.ts`, not `middleware.ts` — the convention was
 * renamed and the exported function must be called `proxy`. It always runs on
 * the Node.js runtime, which cannot be configured.
 *
 * Deliberately does no database work. The `sessions` row is created lazily by
 * getSessionContext() on the first request that actually needs it, which keeps
 * bot traffic and asset requests from writing to Postgres.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SESSION_COOKIE,
  newSessionId,
  sessionCookieOptions,
  signSessionId,
  verifySessionCookie,
} from '@/lib/auth/cookie';

export function proxy(request: NextRequest) {
  const existing = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionCookie(existing)) {
    return NextResponse.next();
  }

  const signed = signSessionId(newSessionId());

  // Set the cookie on the *request* as well as the response. Without this, the
  // very first render reads no cookie, mints a second session id of its own, and
  // leaves an orphan `sessions` row behind on every new visitor.
  request.cookies.set(SESSION_COOKIE, signed);

  const response = NextResponse.next({ request: { headers: request.headers } });
  response.cookies.set(SESSION_COOKIE, signed, sessionCookieOptions());
  return response;
}

export const config = {
  // Static assets never need a session. Without a matcher, Proxy would run for
  // every CSS, JS and image request too.
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
