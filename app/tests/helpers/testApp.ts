import { createApp } from '../../src/app';
import { createRecordings, type Recordings, type RecordingsDeps } from '../../src/recording';
import { createUrls } from '../../src/urls';
import { createViewerPage } from '../../src/viewerPage';
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
  const urls = createUrls({ publicAppUrl: 'https://record.example.com' });
  const defaults = fakeR2();
  const recordings = createRecordings({
    dbPath: ':memory:',
    mintUploadUrl: opts.mintUploadUrl ?? defaults.mintUploadUrl,
    publicUrl: opts.publicUrl ?? defaults.publicUrl,
    viewerUrl: urls.viewerUrl,
    generateSlug: opts.generateSlug,
  });
  const { renderViewerPage } = createViewerPage({ template: VIEWER_TEMPLATE_STUB });
  const app = createApp({
    recordings,
    maxUploadBytes: opts.maxUploadBytes ?? 500 * 1024 * 1024,
    renderViewerPage,
    publicDir: null,
  });
  return { app, recordings, cleanup: () => recordings.close() };
}
