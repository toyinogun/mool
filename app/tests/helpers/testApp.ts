import { createApp } from '../../src/app';
import { openDb, type DB } from '../../src/db';
import type { R2 } from '../../src/r2';
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

export function buildTestApp(opts: { maxUploadBytes?: number } = {}): {
  app: Express;
  db: DB;
  cleanup: () => void;
} {
  const db = openDb(':memory:');
  const app = createApp({
    db,
    r2: fakeR2(),
    maxUploadBytes: opts.maxUploadBytes ?? 500 * 1024 * 1024,
    publicAppUrl: 'https://record.example.com',
    viewerTemplate: VIEWER_TEMPLATE_STUB,
    publicDir: null,
  });
  return { app, db, cleanup: () => db.close() };
}
