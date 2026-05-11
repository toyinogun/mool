import { compose, type ComposeLeaves } from '../../src/compose';
import type { Recordings, RecordingsBaseDeps } from '../../src/recording';
import { createInMemoryAuthStore } from '../../src/auth/authStore';
import type { AuthStore } from '../../src/auth/authStore';
import { createFakeEmailSender, type FakeEmailSender } from '../../src/email/sender';
import { generateToken, hashToken } from '../../src/auth/tokens';
import { SESSION_COOKIE_NAME } from '../../src/auth/cookies';
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
  mintUploadUrl?: RecordingsBaseDeps['mintUploadUrl'];
  /** Override the public-URL composer — rarely needed; default mirrors prod shape. */
  publicUrl?: ComposeLeaves['publicUrl'];
  /** Override the slug generator — useful when a test needs a known slug. */
  generateSlug?: () => string;
  /** Override the auth store — defaults to a fresh in-memory impl. */
  authStore?: AuthStore;
  /** Override the email sender — defaults to a fresh fake. */
  emailSender?: FakeEmailSender;
  /** Override the signin token TTL in seconds — defaults to 900. */
  signinTokenTtlSeconds?: number;
  /** Override the session TTL in seconds — defaults to 2592000 (30 days). */
  sessionTtlSeconds?: number;
  /** Override the Secure cookie flag — defaults to false (tests run over HTTP). */
  cookieSecure?: boolean;
}

export function buildTestApp(opts: BuildTestAppOpts = {}): {
  app: Express;
  recordings: Recordings;
  authStore: AuthStore;
  emailSender: FakeEmailSender;
  cleanup: () => void;
} {
  const defaults = fakeR2();
  const authStore = opts.authStore ?? createInMemoryAuthStore();
  const emailSender = opts.emailSender ?? createFakeEmailSender();
  const { app, recordings } = compose({
    db: null,
    template: VIEWER_TEMPLATE_STUB,
    publicAppUrl: 'https://record.example.com',
    mintUploadUrl: opts.mintUploadUrl ?? defaults.mintUploadUrl,
    publicUrl: opts.publicUrl ?? defaults.publicUrl,
    maxUploadBytes: opts.maxUploadBytes ?? 500 * 1024 * 1024,
    publicDir: null,
    generateSlug: opts.generateSlug,
    authStore,
    emailSender,
    signinTokenTtlSeconds: opts.signinTokenTtlSeconds ?? 900,
    sessionTtlSeconds: opts.sessionTtlSeconds ?? 2592000,
    cookieSecure: opts.cookieSecure ?? false,
  });
  return { app, recordings, authStore, emailSender, cleanup: () => recordings.close() };
}

/**
 * Creates a user + session in the given authStore and returns a cookie string
 * suitable for passing to supertest `.set('Cookie', cookie)`.
 */
export async function signedInCookie(authStore: AuthStore, email = 'a@b.com'): Promise<string> {
  const user = await authStore.upsertUserByEmail({ email, displayName: email.split('@')[0] });
  const raw = generateToken();
  await authStore.insertSession({ tokenHash: hashToken(raw), userId: user.id, expiresAt: new Date(Date.now() + 3600_000) });
  return `${SESSION_COOKIE_NAME}=${raw}`;
}
