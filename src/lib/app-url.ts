/**
 * Absolute origin for links we put in emails and share dialogs.
 *
 * Never derived from a request header: `Host` is attacker-controlled, and a
 * forged host in a magic-link email is a phishing primitive.
 */
export function appUrl(): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');

  // Vercel supplies this for preview deployments where APP_URL is not set.
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`;

  return 'http://localhost:3000';
}
