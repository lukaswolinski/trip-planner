'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/client/api';
import EmailForm from './EmailForm';

interface Props {
  tripId: string;
  initialSlug: string | null;
  /**
   * Absolute origin, supplied by the server from APP_URL.
   *
   * Required because this dialog can render during SSR — arriving back from a
   * magic link with `?share=1` opens it on first paint — and reading
   * `window.location.origin` in a useState initializer threw
   * "window is not defined" and produced a 500 on exactly that flow.
   */
  shareBaseUrl: string;
  onClose: () => void;
  onSlugChange: (slug: string | null) => void;
}

/**
 * Creates or revokes the read-only share link.
 *
 * If the visitor is still anonymous the server answers EMAIL_REQUIRED, and we
 * swap in the email form inline rather than navigating away — losing the trip
 * you were about to share would be a poor trade.
 */
export default function ShareDialog({
  tripId,
  initialSlug,
  shareBaseUrl,
  onClose,
  onSlugChange,
}: Props) {
  // Derived, not stored: no browser globals, so this renders identically on the
  // server and the client.
  const [slug, setSlug] = useState<string | null>(initialSlug);
  const url = slug ? `${shareBaseUrl.replace(/\/+$/, '')}/t/${slug}` : null;
  const [needsEmail, setNeedsEmail] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function createLink() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.share(tripId);
      setSlug(result.shareSlug);
      setNeedsEmail(false);
      onSlugChange(result.shareSlug);
    } catch (err) {
      if (err instanceof ApiError && err.needsEmail) {
        setNeedsEmail(true);
      } else if (err instanceof ApiError && err.isRateLimited) {
        setError('Too many requests — please wait a moment.');
      } else {
        setError('Could not create the link. Please try again.');
      }
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await api.revokeShare(tripId);
      setSlug(null);
      onSlugChange(null);
    } catch {
      setError('Could not revoke the link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share this trip"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl dark:bg-neutral-900"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Share this trip</h2>
        <p className="mt-1 text-xs text-black/60 dark:text-white/60">
          Anyone with the link can view the itinerary. They cannot edit it.
        </p>

        {needsEmail ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30">
            <p className="text-sm font-medium">Add your email first</p>
            <p className="mt-0.5 text-xs opacity-80">
              A share link outlives this browser, so it needs an account to belong to.
              This also claims every trip you have made here.
            </p>
            <div className="mt-2">
              <EmailForm tripId={tripId} submitLabel="Send sign-in link" />
            </div>
          </div>
        ) : url ? (
          <div className="mt-4">
            <div className="flex gap-2">
              <input
                readOnly
                value={url}
                onFocus={(event) => event.currentTarget.select()}
                className="min-w-0 flex-1 rounded border border-black/15 bg-black/[0.03] px-2 py-1.5 font-mono text-xs dark:border-white/20 dark:bg-white/[0.06]"
                aria-label="Share link"
              />
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="mt-3 text-xs text-red-600 underline hover:no-underline disabled:opacity-60 dark:text-red-400"
            >
              Revoke this link
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={createLink}
            disabled={busy}
            className="mt-4 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create share link'}
          </button>
        )}

        {error ? (
          <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>
        ) : null}

        <div className="mt-5 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
