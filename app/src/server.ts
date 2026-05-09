import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { loadConfig, type AppConfig } from './config';
import { createR2 } from './r2';
import { compose } from './compose';
import type { Recordings } from './recording';

export interface BootServerOpts {
  config: AppConfig;
  /** Directory containing `viewer.html`. In production this is `<__dirname>/views`; tests can pass a tmpdir. */
  viewsDir: string;
  /** Directory of static assets to serve, or `null` to skip the static handler. */
  publicDir: string | null;
}

/**
 * Resolves all leaves that depend on filesystem or the AWS SDK, then hands the
 * resolved leaves to `compose`. This is the only place in the server that calls
 * into `node:fs` or constructs the R2 SDK client (see ADR-0011).
 *
 * Exported so `tests/server.test.ts` can exercise the IO path without spawning
 * a child process — the production entry point under `if (require.main === module)`
 * is the only caller in production.
 */
export function bootServer({ config, viewsDir, publicDir }: BootServerOpts): {
  app: Express;
  recordings: Recordings;
} {
  mkdirSync(config.dataDir, { recursive: true });
  const r2 = createR2(config.r2);
  return compose({
    dbPath: path.join(config.dataDir, 'db.sqlite'),
    template: readFileSync(path.join(viewsDir, 'viewer.html'), 'utf8'),
    publicAppUrl: config.publicAppUrl,
    mintUploadUrl: r2.mintUploadUrl,
    publicUrl: r2.publicUrl,
    maxUploadBytes: config.maxUploadBytes,
    publicDir,
  });
}

if (require.main === module) {
  const config = loadConfig();
  const { app } = bootServer({
    config,
    viewsDir: path.join(__dirname, 'views'),
    publicDir: path.join(__dirname, 'public'),
  });
  app.listen(config.port, () => {
    console.log(`Mool listening on :${config.port}`);
  });
}
