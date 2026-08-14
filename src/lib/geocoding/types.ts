/** Shared geocoding contract, so the provider is swappable independently of the router. */

export interface GeocodeResult {
  name: string;
  address: string | null;
  lng: number;
  lat: number;
  /** Human label for the feature type, e.g. "City", "County". Shown in the UI. */
  kind: string;
  /** Sort tier — see lib/geocoding/rank.ts. Lower is a better trip stop. */
  tier: number;
  /** Settlement class ordering within a tier: city 0, town 3, village 4. */
  placeRank: number;
}

export interface GeocodeOptions {
  limit?: number;
  /** Bias results toward this point. */
  proximity?: { lng: number; lat: number };
}

export interface Geocoder {
  name: string;
  search(query: string, options?: GeocodeOptions): Promise<GeocodeResult[]>;
  /**
   * Names a point. Used to label a pasted coordinate.
   *
   * Optional: a provider without reverse support simply means the coordinates
   * themselves are shown as the stop name, which is a fine outcome.
   */
  reverse?(lat: number, lng: number): Promise<GeocodeResult | null>;
}

/** Thrown when the selected geocoder is missing its credentials. */
export class GeocodingNotConfiguredError extends Error {
  constructor(readonly variable: string) {
    super(`${variable} is not set. Copy .env.example to .env.local and fill it in.`);
    this.name = 'GeocodingNotConfiguredError';
  }
}
