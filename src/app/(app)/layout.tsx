import { getSessionContext } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { listTrips } from '@/lib/trips/repository';
import AppShell from '@/components/AppShell';
import type { TripListItem } from '@/types';

/**
 * Shell for the authenticated app: trip history sidebar plus the page content.
 *
 * A route-group layout rather than per-page markup, so the sidebar persists
 * across navigation — it keeps its scroll position, filter text and collapse
 * state instead of re-mounting on every trip you open.
 *
 * The public share page (`/t/[slug]`) sits outside this group on purpose: it must
 * not show someone else's trip history.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: LayoutProps<'/'>) {
  let trips: TripListItem[] = [];
  let claimed = false;
  let email: string | null = null;
  let failure: string | null = null;

  try {
    const db = getDb();
    const context = await getSessionContext();
    claimed = context.userId !== null;
    email = context.email;
    trips = (await listTrips(db, context)).map((trip) => ({
      ...trip,
      defaultProfile: trip.defaultProfile as TripListItem['defaultProfile'],
      updatedAt: trip.updatedAt.toISOString(),
      pinnedAt: trip.pinnedAt?.toISOString() ?? null,
    }));
  } catch (error) {
    // Most likely DATABASE_URL is unset. Say so plainly rather than showing a
    // generic error page during first-time setup.
    console.error('[layout] (app)', error);
    failure =
      error instanceof Error && error.message.includes('DATABASE_URL')
        ? 'DATABASE_URL is not set. Copy .env.example to .env.local and point it at a Postgres database, then run `npm run db:migrate`.'
        : 'Could not load your trips.';
  }

  if (failure) {
    return (
      <div className="mx-auto w-full max-w-2xl p-6">
        <h1 className="text-xl font-semibold">Setup needed</h1>
        <p className="mt-2 text-sm text-black/70 dark:text-white/70">{failure}</p>
      </div>
    );
  }

  return (
    <AppShell trips={trips} claimed={claimed} email={email}>
      {children}
    </AppShell>
  );
}
