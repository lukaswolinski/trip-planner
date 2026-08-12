/**
 * IP bucketing is a security control, not a formatting detail: if IPv6 were
 * bucketed per exact address, anyone could evade the limit by incrementing the
 * last hextet of an address they already hold billions of.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { clientIp, emailRateKey, expandIpv6, ipBucket, ipRateKey } from '@/lib/ip';

beforeAll(() => {
  process.env.RATE_LIMIT_PEPPER = 'test-pepper-not-a-real-secret';
});

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

describe('client IP extraction', () => {
  it('takes the first entry of x-forwarded-for', () => {
    expect(
      clientIp(headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })),
    ).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip', () => {
    expect(clientIp(headers({ 'x-real-ip': '198.51.100.9' }))).toBe('198.51.100.9');
  });

  it('returns null when no forwarding header is present', () => {
    expect(clientIp(headers({}))).toBeNull();
  });

  it('strips an IPv4 port', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '203.0.113.7:54321' }))).toBe('203.0.113.7');
  });

  it('strips brackets and port from IPv6', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '[2001:db8::1]:443' }))).toBe('2001:db8::1');
  });

  it('leaves a bare IPv6 address intact', () => {
    expect(clientIp(headers({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
});

describe('IPv6 expansion', () => {
  it('expands a compressed address to 8 hextets', () => {
    expect(expandIpv6('2001:db8::1')).toEqual([
      '2001', 'db8', '0', '0', '0', '0', '0', '1',
    ]);
  });

  it('expands the all-zeros address', () => {
    expect(expandIpv6('::')).toEqual(['0', '0', '0', '0', '0', '0', '0', '0']);
  });

  it('accepts a fully written address', () => {
    expect(expandIpv6('2001:0db8:0000:0000:0000:0000:0000:0001')).toEqual([
      '2001', 'db8', '0', '0', '0', '0', '0', '1',
    ]);
  });

  it('rejects malformed input rather than guessing', () => {
    expect(expandIpv6('2001:db8::1::2')).toBeNull();
    expect(expandIpv6('2001:db8:zzzz::1')).toBeNull();
    expect(expandIpv6('2001:db8:1:2:3')).toBeNull();
  });
});

describe('bucketing', () => {
  it('buckets IPv4 exactly', () => {
    expect(ipBucket('203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('203.0.113.8')).not.toBe(ipBucket('203.0.113.7'));
  });

  it('groups an entire IPv6 /64 into one bucket', () => {
    const a = ipBucket('2001:db8:1234:5678:0000:0000:0000:0001');
    const b = ipBucket('2001:db8:1234:5678:ffff:ffff:ffff:ffff');
    expect(a).toBe(b);
    expect(a).toBe('2001:db8:1234:5678::/64');
  });

  it('separates different /64 prefixes', () => {
    expect(ipBucket('2001:db8:1234:5678::1')).not.toBe(
      ipBucket('2001:db8:1234:9999::1'),
    );
  });

  it('treats an IPv4-mapped address as its IPv4 address', () => {
    // Otherwise every mapped address collapses into the ::/64 bucket and
    // unrelated visitors would share a limit.
    expect(ipBucket('::ffff:203.0.113.7')).toBe('203.0.113.7');
    expect(ipBucket('::ffff:203.0.113.8')).not.toBe(ipBucket('::ffff:203.0.113.7'));
  });

  it('drops an IPv6 zone id', () => {
    expect(ipBucket('fe80::1%eth0')).toBe(ipBucket('fe80::1'));
  });
});

describe('rate-limit keys', () => {
  it('never contains the raw IP address', () => {
    const key = ipRateKey('route', headers({ 'x-forwarded-for': '203.0.113.7' }));
    expect(key).not.toBeNull();
    expect(key).not.toContain('203.0.113.7');
    expect(key).toMatch(/^route:ip:[A-Za-z0-9_-]+$/);
  });

  it('is stable for the same address and different across addresses', () => {
    const a = ipRateKey('route', headers({ 'x-forwarded-for': '203.0.113.7' }));
    const b = ipRateKey('route', headers({ 'x-forwarded-for': '203.0.113.7' }));
    const c = ipRateKey('route', headers({ 'x-forwarded-for': '203.0.113.8' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('shares a key across one IPv6 /64', () => {
    const a = ipRateKey('route', headers({ 'x-forwarded-for': '2001:db8:1:2::1' }));
    const b = ipRateKey('route', headers({ 'x-forwarded-for': '2001:db8:1:2::dead' }));
    expect(a).toBe(b);
  });

  it('returns null when there is no client IP to key on', () => {
    expect(ipRateKey('route', headers({}))).toBeNull();
  });

  it('hashes emails and normalises case and whitespace', () => {
    const a = emailRateKey('auth', 'Person@Example.com');
    const b = emailRateKey('auth', '  person@example.com ');
    expect(a).toBe(b);
    expect(a).not.toContain('person@example.com');
  });
});
