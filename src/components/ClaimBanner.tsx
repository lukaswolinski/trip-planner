'use client';

import { useSyncExternalStore } from 'react';
import EmailForm from './EmailForm';

interface Props {
  claimed: boolean;
  tripId?: string;
}

const DISMISS_KEY = 'tp_claim_banner_dismissed';

/**
 * Dismissal lives in sessionStorage, not React state derived in an effect.
 *
 * `useSyncExternalStore` is the right tool here: sessionStorage *is* an external
 * store, it is unavailable during SSR (hence the server snapshot), and reading it
 * in an effect-then-setState would cause a cascading render.
 *
 * sessionStorage rather than localStorage is deliberate — the trips genuinely are
 * at risk of being lost, so the prompt should return in a new session rather than
 * being silenceable forever.
 */
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

function getSnapshot(): boolean {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false; // storage blocked (private mode): show the banner
  }
}

/** Hidden during SSR so the server and client markup agree. */
function getServerSnapshot(): boolean {
  return true;
}

function dismiss(): void {
  try {
    sessionStorage.setItem(DISMISS_KEY, '1');
  } catch {
    // Non-fatal: the banner simply reappears on the next render.
  }
  listeners.forEach((listener) => listener());
}

export default function ClaimBanner({ claimed, tripId }: Props) {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  if (claimed || dismissed) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-500/40 dark:bg-amber-950/30 dark:text-amber-100">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">Add your email to keep these trips</p>
          <p className="mt-0.5 text-xs opacity-80">
            Your trips are saved to this browser only. Adding an email keeps them if you
            clear cookies or switch device — and it is required to create a share link.
          </p>
          <div className="mt-2 max-w-md">
            <EmailForm tripId={tripId} submitLabel="Keep my trips" />
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded px-2 py-1 text-xs opacity-70 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
          aria-label="Dismiss for this session"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
