import { createApp } from '../../src/app';
import { openDb, type DB } from '../../src/db';
import { createRecordings, type Recordings } from '../../src/recording';
import type { R2 } from '../../src/r2';
import { createUrls } from '../../src/urls';
import type { Express } from 'express';

export function fakeR2(): R2 {
  return {
    async mintUploadUrl({ key }) {
      return `https://fake-r2.test/${key}?signed=1`;
    },
    publicUrl(key) {
      return `https://videos.example.com/${key}`;
    },
  };
}

const VIEWER_TEMPLATE_STUB = `<!doctype html>
<html><body><video src="{{VIDEO_URL}}"></video></body></html>`;

export interface BuildTestAppOpts {
  maxUploadBytes?: number;
  /** Override the R2 adapter used to construct the default recordings module. */
  r2?: R2;
}

export function buildTestApp(opts: BuildTestAppOpts = {}): {
  app: Express;
  db: DB;
  recordings: Recordings;
  cleanup: () => void;
} {
  const db = openDb(':memory:');
  const urls = createUrls({ publicAppUrl: 'https://record.example.com' });
  const recordings = createRecordings({
    db,
    r2: opts.r2 ?? fakeR2(),
    viewerUrl: urls.viewerUrl,
  });
  const app = createApp({
    recordings,
    maxUploadBytes: opts.maxUploadBytes ?? 500 * 1024 * 1024,
    viewerTemplate: VIEWER_TEMPLATE_STUB,
    publicDir: null,
  });
  return { app, db, recordings, cleanup: () => db.close() };
}
