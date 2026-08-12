/**
 * Session cookie crypto — deliberately free of database and `next/headers`
 * imports so that `proxy.ts` can use it.
 *
 * Next's docs warn that Proxy runs outside the app's main runtime and may be
 * deployed to a CDN edge, so it "should not attempt relying on shared modules
 * or globals". Keeping this module pure is what lets the proxy mint a cookie
 * without dragging a Postgres client along with it.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE = 'tp_session';

/** ~13 months. Long, because losing the cookie means losing anonymous trips. */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'SESSION_SECRET is not set. Copy .env.example to .env.local and fill it in.',
    );
  }
  return secret;
}

export function newSessionId(): string {
  return randomUUID();
}

export function signSessionId(id: string, secret: string = sessionSecret()): string {
  const mac = createHmac('sha256', secret).update(id).digest('base64url');
  return `${id}.${mac}`;
}

/**
 * Returns the session id if the cookie is intact, else null.
 *
 * The signature is what stops a visitor from typing someone else's session id
 * into their own cookie jar and taking over their trips.
 */
export function verifySessionCookie(
  value: string | undefined | null,
  secret: string = sessionSecret(),
): string | null {
  if (!value) return null;

  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const id = value.slice(0, separator);
  const mac = value.slice(separator + 1);
  if (!UUID_RE.test(id) || mac.length === 0) return null;

  const expected = createHmac('sha256', secret).update(id).digest('base64url');
  const provided = Buffer.from(mac);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length) return null;
  if (!timingSafeEqual(provided, computed)) return null;

  return id;
}

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
  maxAge: number;
}

export function sessionCookieOptions(): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: 'lax',
    // Left off in development so the cookie works over plain-HTTP localhost.
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  };
}
