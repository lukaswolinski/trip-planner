/**
 * Loads .env.local before any test module is imported, so database-backed tests
 * can see DATABASE_URL.
 *
 * Vitest does not read .env files itself (that is a Next.js behaviour), and the
 * skip guards in db.test.ts are evaluated at module scope — which runs after
 * setupFiles, so this is early enough.
 */
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

// Deterministic fallbacks for the pure-logic suites, so they never depend on
// whatever happens to be in the developer's environment.
process.env.SESSION_SECRET ??= 'test-session-secret';
process.env.RATE_LIMIT_PEPPER ??= 'test-rate-limit-pepper';
