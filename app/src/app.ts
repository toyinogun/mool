import express, { type Express } from 'express';
import type { DB } from './db';
import type { R2 } from './r2';

export interface AppDeps {
  db: DB;
  r2: R2;
  maxUploadBytes: number;
  publicAppUrl: string;
  viewerTemplate: string;
  /** Absolute path to the static-assets directory, or null in tests. */
  publicDir: string | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '4kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  // Routes added in later tasks will be wired in here.

  if (deps.publicDir) {
    app.use(express.static(deps.publicDir));
  }

  return app;
}
