import 'server-only';

import { Resend } from 'resend';
import { appUrl } from '@/lib/app-url';

export interface MagicLinkEmail {
  to: string;
  token: string;
  tripId?: string;
}

export type MailResult =
  /** Handed to the email provider successfully. */
  | { delivered: true }
  /**
   * No email provider is configured. In development the link is returned so
   * sign-in can still be completed; the caller must tell the user plainly that
   * nothing was sent.
   */
  | { delivered: false; reason: 'NOT_CONFIGURED'; devLink?: string };

export class MailNotConfiguredError extends Error {
  constructor() {
    super(
      'Email is not configured: set RESEND_API_KEY and MAIL_FROM to send magic links.',
    );
    this.name = 'MailNotConfiguredError';
  }
}

/**
 * Sends the magic link, and — crucially — reports whether it actually went
 * anywhere.
 *
 * The previous version logged the link to the server console and returned
 * normally when unconfigured, so the UI cheerfully said "check your inbox" for
 * an email that was never sent. Silence like that is worse than an error,
 * because there is nothing to search for.
 */
export async function sendMagicLink({
  to,
  token,
  tripId,
}: MagicLinkEmail): Promise<MailResult> {
  const params = new URLSearchParams({ token });
  if (tripId) params.set('trip', tripId);
  const link = `${appUrl()}/api/auth/verify?${params.toString()}`;

  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.MAIL_FROM?.trim();

  if (!apiKey || !from) {
    if (process.env.NODE_ENV === 'production') {
      // In production a missing provider is a hard error, not a degraded mode.
      throw new MailNotConfiguredError();
    }
    console.info(
      `\n[dev] Email is not configured (RESEND_API_KEY / MAIL_FROM unset).\n` +
        `[dev] Sign-in link for ${to}:\n${link}\n`,
    );
    // Returned only outside production, and only because the person asking is
    // the same person who would have received the email.
    return { delivered: false, reason: 'NOT_CONFIGURED', devLink: link };
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from,
    to,
    subject: 'Your sign-in link',
    text: [
      'Click to sign in and keep your trips:',
      '',
      link,
      '',
      'This link works once and expires in 15 minutes.',
      "If you didn't request it, you can ignore this email.",
    ].join('\n'),
  });

  if (error) {
    throw new Error(`Resend failed to send magic link: ${error.message}`);
  }

  return { delivered: true };
}
