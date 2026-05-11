/**
 * Single source of truth for Mool's wiring graph.
 *
 * Both the production entry point (`server.ts`) and the test harness
 * (`tests/helpers/testApp.ts`) call `compose` with their own leaves —
 * production passes a real R2 + a disk-loaded template + a real db path;
 * tests pass fakes + `:memory:` + a stub template. The wiring shape between
 * the leaves and the Express app lives once, here.
 *
 * `compose` is filesystem-free by design (see ADR-0011): the composition
 * root — `server.ts` — owns mkdirSync/readFileSync/createR2 and threads
 * the resolved leaves in. Tests do no IO because their leaves are strings.
 */

import type { Express } from 'express';
import { createApp } from './app';
import { createRecordings, type Recordings, type RecordingsDeps } from './recording';
import { createUrls } from './urls';
import { createViewerPage } from './viewerPage';
import type { Db } from './db/client';
import type { AuthStore } from './auth/authStore';
import type { EmailSender } from './email/sender';

export interface ComposeLeaves {
  /** Path to the SQLite file; use ':memory:' for tests. Removed in Task 12. */
  dbPath: string;
  /** Drizzle Postgres handle. `null` permitted in tests that don't exercise PG-backed code. */
  db: Db | null;
  /** The Viewer page HTML template, already loaded. */
  template: string;
  /** Mool's public-facing app URL, e.g. `https://record.example.com`. */
  publicAppUrl: string;
  /** R2 minter — production passes the real SDK call; tests pass a fake. */
  mintUploadUrl: RecordingsDeps['mintUploadUrl'];
  /** R2 public-URL composer — consumed by the Viewer route per ADR-0015. */
  publicUrl: (key: string) => string;
  /** Hard limit on Upload sizes accepted by `/create-upload`. */
  maxUploadBytes: number;
  /** Absolute path to the static-assets directory in production; `null` in tests. */
  publicDir: string | null;
  /** Optional slug-generator override — used by tests that need a known slug. */
  generateSlug?: () => string;
  /** Auth store — production passes the Postgres impl; tests pass the in-memory impl. */
  authStore: AuthStore;
  /** Email sender — production passes the Resend impl; tests pass the fake. */
  emailSender: EmailSender;
  /** How long a magic-link signin token is valid for, in seconds. */
  signinTokenTtlSeconds: number;
  /** How long a session cookie is valid for, in seconds. */
  sessionTtlSeconds: number;
  /** Whether to set the Secure flag on the session cookie. */
  cookieSecure: boolean;
}

export function compose(leaves: ComposeLeaves): { app: Express; recordings: Recordings } {
  const urls = createUrls({ publicAppUrl: leaves.publicAppUrl });
  const recordings = createRecordings({
    dbPath: leaves.dbPath,
    mintUploadUrl: leaves.mintUploadUrl,
    viewerUrl: urls.viewerUrl,
    generateSlug: leaves.generateSlug,
  });
  const { renderViewerPage } = createViewerPage({ template: leaves.template });
  const app = createApp({
    recordings,
    authStore: leaves.authStore,
    emailSender: leaves.emailSender,
    maxUploadBytes: leaves.maxUploadBytes,
    renderViewerPage,
    publicUrl: leaves.publicUrl,
    publicDir: leaves.publicDir,
    publicAppUrl: leaves.publicAppUrl,
    signinTokenTtlSeconds: leaves.signinTokenTtlSeconds,
    sessionTtlSeconds: leaves.sessionTtlSeconds,
    cookieSecure: leaves.cookieSecure,
  });
  return { app, recordings };
}
