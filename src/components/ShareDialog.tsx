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
      className="fixed inset-0 z-50 flex items-center justify-center bg-inset p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Share this trip"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-card bg-surface p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-base font-semibold">Share this trip</h2>
        <p className="mt-1 text-xs text-ink-muted">
          Anyone with the link can view the itinerary. They cannot edit it.
        </p>

        {needsEmail ? (
          <div className="mt-4 rounded-control border border-warn-line bg-warn-soft p-3">
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
                className="min-w-0 flex-1 rounded border border-line bg-inset px-2 py-1.5 font-mono text-xs"
                aria-label="Share link"
              />
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
                className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button
              type="button"
              onClick={revoke}
              disabled={busy}
              className="mt-3 text-xs text-danger underline hover:no-underline disabled:opacity-60"
            >
              Revoke this link
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={createLink}
            disabled={busy}
            className="mt-4 rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create share link'}
          </button>
        )}

        {error ? (
          <p className="mt-3 text-xs text-danger">{error}</p>
        ) : null}

        <div className="mt-5 text-right">
          <button
            type="button"
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm hover:bg-inset"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
