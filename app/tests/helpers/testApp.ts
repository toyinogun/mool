import { compose, type ComposeLeaves } from '../../src/compose';
import type { Recordings, RecordingsDeps } from '../../src/recording';
import { createInMemoryAuthStore } from '../../src/auth/authStore';
import type { AuthStore } from '../../src/auth/authStore';
import { createFakeEmailSender, type FakeEmailSender } from '../../src/email/sender';
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
  publicUrl?: ComposeLeaves['publicUrl'];
  /** Override the slug generator — useful when a test needs a known slug. */
  generateSlug?: () => string;
  /** Override the auth store — defaults to a fresh in-memory impl. */
  authStore?: AuthStore;
  /** Override the email sender — defaults to a fresh fake. */
  emailSender?: FakeEmailSender;
}

export function buildTestApp(opts: BuildTestAppOpts = {}): {
  app: Express;
  recordings: Recordings;
  emailSender: FakeEmailSender;
  cleanup: () => void;
} {
  const defaults = fakeR2();
  const authStore = opts.authStore ?? createInMemoryAuthStore();
  const emailSender = opts.emailSender ?? createFakeEmailSender();
  const { app, recordings } = compose({
    dbPath: ':memory:',
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
  });
  return { app, recordings, emailSender, cleanup: () => recordings.close() };
}
