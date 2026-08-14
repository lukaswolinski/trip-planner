import { getSessionContext } from '@/lib/auth/session';
import ClaimBanner from '@/components/ClaimBanner';

export const dynamic = 'force-dynamic';

/**
 * Empty state. The trip list now lives in the sidebar, so this is what fills the
 * main area before a trip is opened.
 */
export default async function Home({ searchParams }: PageProps<'/'>) {
  const params = await searchParams;
  const signin = typeof params.signin === 'string' ? params.signin : null;

  let claimed = false;
  let email: string | null = null;
  try {
    const context = await getSessionContext();
    claimed = context.userId !== null;
    email = context.email;
  } catch {
    // The layout already surfaced any setup problem.
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col justify-center gap-5 p-8">
      {signin === 'ok' && email ? (
        <p className="rounded-control border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          Signed in as {email}. Your trips are saved to this account.
        </p>
      ) : null}
      {signin === 'expired' ? (
        <p className="rounded-control border border-warn-line bg-warn-soft px-3 py-2 text-sm text-ink">
          That sign-in link has already been used or has expired. Request a new one.
        </p>
      ) : null}

      <ClaimBanner claimed={claimed} />

      <div className="rounded-card border border-dashed border-line p-10 text-center">
        <h1 className="text-lg font-semibold">No trip open</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
          Pick a trip from the sidebar, or start a new one. There is no cap on how
          many stops a trip can have.
        </p>
      </div>
    </div>
  );
}
