import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Express } from 'express';
import { loadConfig, type AppConfig } from './config';
import { createR2 } from './r2';
import { compose } from './compose';
import { createDb, runMigrations, type DbHandle } from './db/client';
import { createPostgresAuthStore, createInMemoryAuthStore, type AuthStore } from './auth/authStore';
import { createResendSender } from './email/sender';
import type { Recordings } from './recording';

export interface BootServerOpts {
  config: AppConfig;
  /** Directory containing `viewer.html`. In production this is `<__dirname>/views`; tests can pass a tmpdir. */
  viewsDir: string;
  /** Directory of static assets to serve, or `null` to skip the static handler. */
  publicDir: string | null;
  /** When true, skip both db construction and migration. Used by tests that don't exercise the data layer. */
  skipDb?: boolean;
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
export async function bootServer({ config, viewsDir, publicDir, skipDb }: BootServerOpts): Promise<{
  app: Express;
  recordings: Recordings;
  dbHandle: DbHandle | null;
}> {
  mkdirSync(config.dataDir, { recursive: true });
  let dbHandle: DbHandle | null = null;
  if (!skipDb) {
    dbHandle = createDb(config.databaseUrl);
    await runMigrations(dbHandle.db, path.join(__dirname, '..', 'db', 'migrations'));
  }
  const r2 = createR2(config.r2);
  const emailSender = createResendSender({ apiKey: config.resend.apiKey, from: config.resend.from });
  let authStore: AuthStore;
  if (dbHandle) {
    authStore = createPostgresAuthStore({ db: dbHandle.db });
  } else {
    if (!skipDb) {
      throw new Error('authStore: dbHandle is null but skipDb is false — check DATABASE_URL');
    }
    authStore = createInMemoryAuthStore();
  }
  const { app, recordings } = compose({
    db: dbHandle?.db ?? null,
    template: readFileSync(path.join(viewsDir, 'viewer.html'), 'utf8'),
    libraryTemplate: readFileSync(path.join(viewsDir, 'library.html'), 'utf8'),
    publicAppUrl: config.publicAppUrl,
    mintUploadUrl: r2.mintUploadUrl,
    publicUrl: r2.publicUrl,
    deleteObject: (key) => r2.deleteObject(key),
    maxUploadBytes: config.maxUploadBytes,
    publicDir,
    authStore,
    emailSender,
    signinTokenTtlSeconds: config.signinTokenTtlSeconds,
    sessionTtlSeconds: config.sessionTtlSeconds,
    cookieSecure: config.cookieSecure,
  });
  return { app, recordings, dbHandle };
}

if (require.main === module) {
  (async () => {
    const config = loadConfig();
    const { app } = await bootServer({
      config,
      viewsDir: path.join(__dirname, 'views'),
      publicDir: path.join(__dirname, 'public'),
    });
    app.listen(config.port, () => {
      console.log(`Mool listening on :${config.port}`);
    });
  })().catch((err) => {
    console.error('Fatal boot error:', err);
    process.exit(1);
  });
}
