/** HTTP transport for the OSRM demo servers. Server-only; see osrm.ts for the dialect. */
import 'server-only';

import {
  RoutingUnreachableError,
  isNetworkFailure,
  type DirectionsResponse,
  type DirectionsTransport,
} from '../chunked-router';
import { createThrottle } from '../throttle';
import { osmUserAgent, osrmBaseUrl } from './osrm';

/**
 * The demo servers ask for at most ~1 request/second. See throttle.ts for the
 * single-process scope caveat.
 */
const throttle = createThrottle(Number(process.env.OSRM_MIN_INTERVAL_MS ?? 1100));

export const osrmTransport: DirectionsTransport = async (relativeUrl) => {
  const url = `${osrmBaseUrl()}/${relativeUrl}`;

  let response: Response;
  try {
    response = await throttle.run(() =>
      fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json', 'User-Agent': osmUserAgent() },
      }),
    );
  } catch (error) {
    // The demo servers time out and reset connections in normal operation, so
    // translate that into something the UI can explain rather than a bare 500.
    if (isNetworkFailure(error)) {
      throw new RoutingUnreachableError(osrmBaseUrl(), error);
    }
    throw error;
  }

  if (!response.ok) {
    const body = await safeText(response);
    throw new Error(
      `OSRM responded ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`,
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
