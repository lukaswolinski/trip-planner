'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/client/api';

interface Props {
  /** Included in the link so verifying returns to this trip. */
  tripId?: string;
  submitLabel?: string;
  onSent?: () => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent' }
  /** The server accepted the request but no email provider is configured. */
  | { kind: 'not-configured'; devLink?: string; message: string };

/**
 * Requests a magic link. Signing in is what claims every trip made in this
 * browser, so the copy leads with that rather than with "create an account".
 */
export default function EmailForm({ tripId, submitLabel = 'Send link', onSent }: Props) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (state.kind === 'sending') return;

    setState({ kind: 'sending' });
    setError(null);
    try {
      const result = await api.requestSignIn({ email, tripId });

      // The server tells us whether anything was actually sent. Showing "check
      // your inbox" for an email that was never sent is worse than an error.
      if (result.sent === false) {
        setState({
          kind: 'not-configured',
          devLink: result.devLink,
          message: result.message ?? 'Email is not configured on this server.',
        });
        return;
      }

      setState({ kind: 'sent' });
      onSent?.();
    } catch (err) {
      setState({ kind: 'idle' });
      if (err instanceof ApiError && err.isRateLimited) {
        setError('Too many attempts. Please wait a while and try again.');
      } else if (err instanceof ApiError && err.code === 'UPSTREAM_ERROR') {
        setError(err.message);
      } else if (err instanceof ApiError && err.status === 400) {
        setError('That does not look like a valid email address.');
      } else {
        setError('Could not send the link. Please try again.');
      }
    }
  }

  if (state.kind === 'sent') {
    return (
      <p className="text-sm">
        Check your inbox — the link works once and expires in 15 minutes.
      </p>
    );
  }

  if (state.kind === 'not-configured') {
    return (
      <div className="space-y-2 text-sm">
        <p className="font-medium text-ink">
          No email was sent — email delivery is not set up on this server.
        </p>
        {state.devLink ? (
          <>
            <p className="text-xs opacity-80">
              You are running in development, so you can sign in with this link
              directly. It works once and expires in 15 minutes.
            </p>
            <a
              href={state.devLink}
              className="block break-all rounded border border-line bg-inset px-2 py-1.5 font-mono text-xs underline hover:bg-inset"
            >
              {state.devLink}
            </a>
          </>
        ) : (
          <p className="text-xs opacity-80">{state.message}</p>
        )}
        <button
          type="button"
          onClick={() => setState({ kind: 'idle' })}
          className="text-xs underline hover:no-underline"
        >
          Try a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-start gap-2">
      <input
        type="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        placeholder="you@example.com"
        className="min-w-0 flex-1 rounded border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
        aria-label="Email address"
      />
      <button
        type="submit"
        disabled={state.kind === 'sending'}
        className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-60"
      >
        {state.kind === 'sending' ? 'Sending…' : submitLabel}
      </button>
      {error ? (
        <p className="w-full text-xs text-danger">{error}</p>
      ) : null}
    </form>
  );
}
