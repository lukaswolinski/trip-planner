import { describe, expect, it } from 'vitest';
import { rateLimitResponse, windowStart } from '@/lib/rate-limit';
import { getLimits } from '@/lib/limits';

describe('fixed window maths', () => {
  it('snaps to the start of the containing minute', () => {
    const now = new Date('2026-08-11T14:37:42.500Z');
    expect(windowStart(now, 60).toISOString()).toBe('2026-08-11T14:37:00.000Z');
  });

  it('snaps to the start of the containing hour', () => {
    const now = new Date('2026-08-11T14:37:42Z');
    expect(windowStart(now, 3600).toISOString()).toBe('2026-08-11T14:00:00.000Z');
  });

  it('gives every instant in a window the same key', () => {
    const a = windowStart(new Date('2026-08-11T14:37:00.000Z'), 60);
    const b = windowStart(new Date('2026-08-11T14:37:59.999Z'), 60);
    expect(a.getTime()).toBe(b.getTime());
  });

  it('moves to a new window at the boundary', () => {
    const a = windowStart(new Date('2026-08-11T14:37:59.999Z'), 60);
    const b = windowStart(new Date('2026-08-11T14:38:00.000Z'), 60);
    expect(b.getTime()).toBe(a.getTime() + 60_000);
  });
});

describe('limit configuration', () => {
  const limits = getLimits('free');

  it('makes IP buckets looser than session buckets', () => {
    // Cafés, universities and mobile networks put many real users behind one
    // address, so the IP bucket must not be the binding constraint for normal
    // use — it exists to catch cookie-clearing abuse.
    expect(limits.rate.routeSummary.ip.limit).toBeGreaterThan(
      limits.rate.routeSummary.session.limit,
    );
    expect(limits.rate.geocode.ip.limit).toBeGreaterThan(
      limits.rate.geocode.session.limit,
    );
    expect(limits.rate.writes.ip.limit).toBeGreaterThan(limits.rate.writes.session.limit);
  });

  it('limits magic links per email as well as per IP', () => {
    expect(limits.rate.authRequest.email.limit).toBeGreaterThan(0);
    expect(limits.rate.authRequest.ip.limit).toBeGreaterThan(0);
    expect(limits.rate.authRequest.email.windowSeconds).toBe(3600);
  });

  it('keeps the public share recompute bucket tight', () => {
    expect(limits.rate.sharePageRecompute.ip.limit).toBeLessThanOrEqual(10);
  });

  it('returns identical limits for both tiers today', () => {
    // Pro exists as a column and a code path, not yet as different numbers.
    expect(getLimits('pro')).toEqual(getLimits('free'));
  });
});

describe('429 response', () => {
  it('sets Retry-After and names the bucket', async () => {
    const response = rateLimitResponse({
      allowed: false,
      scope: 'ip',
      limit: 100,
      retryAfterSeconds: 42,
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');

    const body = await response.json();
    expect(body.error).toBe('RATE_LIMITED');
    expect(body.scope).toBe('ip');
    expect(body.limit).toBe(100);
    expect(body.message).toMatch(/network/i);
  });

  it('uses a session-specific message for session buckets', async () => {
    const response = rateLimitResponse({
      allowed: false,
      scope: 'session',
      limit: 30,
      retryAfterSeconds: 10,
    });
    const body = await response.json();
    expect(body.message).not.toMatch(/network/i);
  });
});
