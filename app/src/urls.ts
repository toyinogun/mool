/**
 * Single owner of Mool's public-facing URL shapes for Recordings.
 *
 * The Express route template (`VIEWER_ROUTE`) and the absolute Viewer URL
 * builder (`createUrls(...).viewerUrl`) live here together so the two halves
 * of the contract — the path the server mounts vs. the URL the Recording
 * module hands back to clients — can't drift independently. The round-trip
 * test in tests/urls.test.ts pins them.
 *
 * The Recording module does NOT know `publicAppUrl`. It receives `viewerUrl`
 * as a dep and stays scoped to Recordings. See docs/adr/0003.
 */

export const VIEWER_ROUTE = '/v/:slug';

export interface UrlsConfig {
  publicAppUrl: string;
}

export interface Urls {
  /** Absolute Viewer URL for a Recording, e.g. `https://record.example.com/v/abc123`. */
  viewerUrl(slug: string): string;
}

export function createUrls(cfg: UrlsConfig): Urls {
  return {
    viewerUrl: (slug) => `${cfg.publicAppUrl}/v/${slug}`,
  };
}
