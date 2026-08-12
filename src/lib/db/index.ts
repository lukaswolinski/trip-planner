import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * postgres.js rather than the Neon serverless driver: one code path that works
 * against a local Postgres, a Docker container, or Neon's pooled endpoint on
 * Vercel. Keep `max` small — serverless functions each hold their own pool, so
 * a large per-instance pool multiplies into connection exhaustion.
 */
let cached: ReturnType<typeof create> | null = null;

function create(url: string) {
  const client = postgres(url, {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // required when talking through a transaction pooler
  });
  return drizzle(client, { schema });
}

export type Database = ReturnType<typeof create>;

export function getDb(): Database {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.',
    );
  }
  cached = create(url);
  return cached;
}

export { schema };
