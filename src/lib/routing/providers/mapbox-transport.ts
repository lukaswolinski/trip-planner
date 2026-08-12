/** HTTP transport for Mapbox Directions. Holds the secret token; server-only. */
import 'server-only';

import {
  RoutingNotConfiguredError,
  type DirectionsResponse,
  type DirectionsTransport,
} from '../chunked-router';
import { MAPBOX_DIRECTIONS_BASE } from './mapbox';

export function mapboxSecretToken(): string {
  const token = process.env.MAPBOX_SECRET_TOKEN;
  if (!token) throw new RoutingNotConfiguredError('MAPBOX_SECRET_TOKEN');
  return token;
}

export const mapboxTransport: DirectionsTransport = async (relativeUrl) => {
  // relativeUrl already carries a query string, so the token appends with '&'.
  const url = `${MAPBOX_DIRECTIONS_BASE}${relativeUrl}&access_token=${encodeURIComponent(mapboxSecretToken())}`;

  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    const body = await safeText(response);
    throw new Error(
      `Mapbox Directions responded ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
    );
  }

  return (await response.json()) as DirectionsResponse;
};

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return '';
  }
}
