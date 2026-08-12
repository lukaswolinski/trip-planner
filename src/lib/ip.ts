/**
 * Client IP extraction and bucketing for rate limiting.
 *
 * Two things here are load-bearing:
 *
 * 1. IPv6 is bucketed by /64 prefix. A single machine is routinely handed
 *    billions of addresses inside one /64, so limiting per exact IPv6 address
 *    would be trivially evaded by incrementing the last hextet.
 *
 * 2. Rate-limit keys hold a salted HMAC of the address, never the address
 *    itself. Counting works identically on a hash, and we avoid keeping a log
 *    of visitor IPs.
 */

import { createHmac } from 'node:crypto';

/**
 * On Vercel, `x-forwarded-for` is set by the edge and cannot be spoofed by the
 * client, so trusting the first entry is correct.
 *
 * If this app ever moves behind a self-managed proxy, that assumption must be
 * re-verified: a naively configured reverse proxy appends to a client-supplied
 * header, letting anyone forge the first entry and mint unlimited buckets.
 *
 * `request.ip` was removed in Next 16 — don't reach for it.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return stripPort(first);
  }
  const real = headers.get('x-real-ip')?.trim();
  return real ? stripPort(real) : null;
}

function stripPort(raw: string): string {
  let value = raw.trim();

  // Bracketed IPv6 with optional port: [2001:db8::1]:443
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    if (end > 0) return value.slice(1, end);
  }

  // IPv4 with port has exactly one colon; bare IPv6 has two or more.
  if ((value.match(/:/g)?.length ?? 0) === 1) {
    value = value.split(':')[0];
  }
  return value;
}

/**
 * Collapses an address to the unit we rate-limit on: the exact address for
 * IPv4, the /64 prefix for IPv6.
 */
export function ipBucket(ip: string): string {
  const address = ip.split('%')[0].trim(); // drop any zone id

  if (!address.includes(':')) return address; // IPv4

  // IPv4-mapped / embedded IPv4 (::ffff:1.2.3.4) is bucketed as the IPv4
  // address. Treating it as IPv6 would collapse every mapped address into a
  // single /64 bucket and rate-limit unrelated visitors together.
  if (address.includes('.')) {
    const tail = address.slice(address.lastIndexOf(':') + 1);
    if (isIpv4(tail)) return tail;
  }

  const groups = expandIpv6(address);
  if (!groups) return address; // unparseable: bucket verbatim rather than guess
  return `${groups.slice(0, 4).join(':')}::/64`;
}

function isIpv4(value: string): boolean {
  const parts = value.split('.');
  return (
    parts.length === 4 &&
    parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  );
}

/** Expands an IPv6 address to its 8 hextets, or null if malformed. */
export function expandIpv6(address: string): string[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): string[] => (part ? part.split(':') : []);

  let groups: string[];
  if (halves.length === 2) {
    const left = parse(halves[0]);
    const right = parse(halves[1]);
    const fill = 8 - left.length - right.length;
    if (fill < 0) return null;
    groups = [...left, ...Array(fill).fill('0'), ...right];
  } else {
    groups = parse(halves[0]);
    if (groups.length !== 8) return null;
  }

  const normalized: string[] = [];
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    normalized.push(parseInt(group, 16).toString(16));
  }
  return normalized;
}

function pepper(): string {
  const value = process.env.RATE_LIMIT_PEPPER;
  if (!value) {
    throw new Error(
      'RATE_LIMIT_PEPPER is not set. Copy .env.example to .env.local and fill it in.',
    );
  }
  return value;
}

/**
 * Builds a rate-limit key for the request's IP, e.g. `route:ip:9f3c...`.
 * Returns null when no client IP could be determined, which callers should
 * treat as "no IP bucket to check" rather than as permission.
 */
export function ipRateKey(prefix: string, headers: Headers): string | null {
  const ip = clientIp(headers);
  if (!ip) return null;
  const digest = createHmac('sha256', pepper()).update(ipBucket(ip)).digest('base64url');
  return `${prefix}:ip:${digest.slice(0, 32)}`;
}

/** Same HMAC treatment for email addresses in the magic-link limiter. */
export function emailRateKey(prefix: string, email: string): string {
  const digest = createHmac('sha256', pepper())
    .update(email.trim().toLowerCase())
    .digest('base64url');
  return `${prefix}:email:${digest.slice(0, 32)}`;
}

export function sessionRateKey(prefix: string, sessionId: string): string {
  return `${prefix}:sess:${sessionId}`;
}
