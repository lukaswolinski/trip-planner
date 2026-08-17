/**
 * Confirms the database actually has the schema the code expects.
 *
 * `drizzle-kit migrate` printing "migrations applied successfully" only means
 * the files ran — it does not tell you whether the database you were pointed at
 * is the one you meant. This checks the tables and the columns added by recent
 * migrations, and prints which database it inspected, so a successful run is
 * evidence rather than an assumption.
 *
 * Usage (never edit .env.local for this — see the comment below):
 *
 *   $env:DATABASE_URL = "<production url>"
 *   node scripts/verify-schema.mjs
 *   Remove-Item Env:\DATABASE_URL
 *
 * The shell variable wins over .env.local because dotenv does not overwrite
 * variables already present in the environment. That matters: several tests
 * delete rows database-wide, so pointing .env.local at production and
 * forgetting to change it back would be genuinely dangerous.
 */
import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

/** Tables the app cannot run without, with the columns worth checking. */
const EXPECTED = {
  users: ['id', 'email', 'tier'],
  sessions: ['id', 'user_id'],
  trips: ['id', 'title', 'share_slug', 'pinned_at', 'budget_total_cents', 'budget_currency'],
  stops: ['id', 'trip_id', 'position', 'lat', 'lng', 'days'],
  route_legs: ['id', 'profile', 'distance_m', 'duration_s', 'is_flight'],
  magic_tokens: ['token_hash', 'email'],
  rate_limits: ['key', 'window_start', 'count'],
  itinerary_items: ['id', 'stop_id', 'position', 'title', 'start_minutes'],
  trip_members: ['id', 'trip_id', 'user_id', 'email', 'role', 'accepted_at'],
  expenses: ['id', 'trip_id', 'description', 'amount_cents', 'paid_by_member_id'],
  expense_shares: ['id', 'expense_id', 'member_id', 'share_cents'],
};

const sql = postgres(url, { max: 1, onnotice: () => {} });

try {
  const [{ db, host }] = await sql`
    select current_database() as db, inet_server_addr()::text as host
  `;
  // Host, so it is obvious if this is not the database you intended.
  console.log(`database : ${db}`);
  console.log(`host     : ${host ?? '(local socket)'}`);
  console.log(`url host : ${(url.match(/@([^/?]+)/) ?? [])[1] ?? '(unparsed)'}\n`);

  const rows = await sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  `;

  const actual = new Map();
  for (const row of rows) {
    if (!actual.has(row.table_name)) actual.set(row.table_name, new Set());
    actual.get(row.table_name).add(row.column_name);
  }

  let failures = 0;
  for (const [table, columns] of Object.entries(EXPECTED)) {
    const present = actual.get(table);
    if (!present) {
      console.log(`MISSING TABLE   ${table}`);
      failures++;
      continue;
    }
    const missing = columns.filter((column) => !present.has(column));
    if (missing.length > 0) {
      console.log(`MISSING COLUMNS ${table}: ${missing.join(', ')}`);
      failures++;
    } else {
      console.log(`ok              ${table} (${columns.length} columns checked)`);
    }
  }

  const applied = await sql`
    select count(*)::int as n from drizzle.__drizzle_migrations
  `.catch(() => [{ n: null }]);
  console.log(`\nmigrations recorded: ${applied[0].n ?? 'unknown'}`);

  if (failures > 0) {
    console.log(`\n${failures} problem(s). Run: npm run db:migrate`);
    process.exit(1);
  }
  console.log('\nSchema is up to date.');
} finally {
  await sql.end();
}
