/**
 * The cookie signature is what stops a visitor pasting someone else's session
 * id into their own cookie jar and taking over their trips.
 */

import { describe, expect, it } from 'vitest';
import {
  newSessionId,
  sessionCookieOptions,
  signSessionId,
  verifySessionCookie,
} from '@/lib/auth/cookie';

const SECRET = 'test-secret-not-a-real-key';
const OTHER_SECRET = 'a-different-secret';

describe('session cookie', () => {
  it('round-trips a signed id', () => {
    const id = newSessionId();
    expect(verifySessionCookie(signSessionId(id, SECRET), SECRET)).toBe(id);
  });

  it('rejects an unsigned id', () => {
    const id = newSessionId();
    expect(verifySessionCookie(id, SECRET)).toBeNull();
  });

  it('rejects a forged session id with someone else signature', () => {
    const victim = newSessionId();
    const attacker = newSessionId();
    const stolenSignature = signSessionId(attacker, SECRET).split('.')[1];
    expect(verifySessionCookie(`${victim}.${stolenSignature}`, SECRET)).toBeNull();
  });

  it('rejects a signature made with a different secret', () => {
    const id = newSessionId();
    expect(verifySessionCookie(signSessionId(id, OTHER_SECRET), SECRET)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const id = newSessionId();
    const signed = signSessionId(id, SECRET);
    const tampered = `${signed.slice(0, -1)}${signed.endsWith('A') ? 'B' : 'A'}`;
    expect(verifySessionCookie(tampered, SECRET)).toBeNull();
  });

  it('rejects a non-uuid payload even when correctly signed', () => {
    const signed = signSessionId('not-a-uuid', SECRET);
    expect(verifySessionCookie(signed, SECRET)).toBeNull();
  });

  it('rejects empty and malformed values', () => {
    expect(verifySessionCookie(undefined, SECRET)).toBeNull();
    expect(verifySessionCookie('', SECRET)).toBeNull();
    expect(verifySessionCookie('nodot', SECRET)).toBeNull();
    expect(verifySessionCookie('.onlysig', SECRET)).toBeNull();
    expect(verifySessionCookie(`${newSessionId()}.`, SECRET)).toBeNull();
  });

  it('is httpOnly, lax and path-scoped to the whole site', () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBeGreaterThan(60 * 60 * 24 * 300);
  });
});
