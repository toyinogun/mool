import { compose } from '../../src/compose';
import type { Recordings, RecordingsDeps } from '../../src/recording';
import type { Express } from 'express';

export function fakeR2() {
  return {
    async mintUploadUrl({ key }: { key: string; contentType: string; sizeBytes: number }) {
      return `https://fake-r2.test/${key}?signed=1`;
    },
    publicUrl(key: string) {
      return `https://videos.example.com/${key}`;
    },
  };
}

const VIEWER_TEMPLATE_STUB = `<!doctype html>
<html><body><video src="{{PLAYBACK_URL}}"></video></body></html>`;

export interface BuildTestAppOpts {
  maxUploadBytes?: number;
  /** Override the upload-URL minter — useful for capturing or simulating R2 failure. */
  mintUploadUrl?: RecordingsDeps['mintUploadUrl'];
  /** Override the public-URL composer — rarely needed; default mirrors prod shape. */
  publicUrl?: RecordingsDeps['publicUrl'];
  /** Override the slug generator — useful when a test needs a known slug. */
  generateSlug?: () => string;
}

export function buildTestApp(opts: BuildTestAppOpts = {}): {
  app: Express;
  recordings: Recordings;
  cleanup: () => void;
} {
  const defaults = fakeR2();
  const { app, recordings } = compose({
    dbPath: ':memory:',
    template: VIEWER_TEMPLATE_STUB,
    publicAppUrl: 'https://record.example.com',
    mintUploadUrl: opts.mintUploadUrl ?? defaults.mintUploadUrl,
    publicUrl: opts.publicUrl ?? defaults.publicUrl,
    maxUploadBytes: opts.maxUploadBytes ?? 500 * 1024 * 1024,
    publicDir: null,
    generateSlug: opts.generateSlug,
  });
  return { app, recordings, cleanup: () => recordings.close() };
}
