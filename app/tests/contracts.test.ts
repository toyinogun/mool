import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import type {
  CreateUploadResponse,
  CreateUploadErrorCode,
} from '../src/routes/createUpload';
import { ALLOWED_MIME, type AllowedMime } from '../src/recording';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — JSDoc-typed JS module shipped to the browser as well.
import { pickMimeType } from '../src/public/recorderCapture.js';
import { buildTestApp, signedInCookie } from './helpers/testApp';

describe('ALLOWED_MIME contract', () => {
  it('is the shared source of truth for accepted recorder content types', () => {
    expect(ALLOWED_MIME).toEqual([
      'video/webm',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
    ]);
    // Frozen so the route cannot mutate the contract at runtime.
    expect(Object.isFrozen(ALLOWED_MIME)).toBe(true);
    // Type-level: AllowedMime narrows to the same literals (compile-time check).
    const samples: AllowedMime[] = [
      'video/webm',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
    ];
    for (const s of samples) expect(ALLOWED_MIME).toContain(s);
  });
});

// The Recorder page's `pickMimeType` chooses one of these codecs based on
// browser support; the server's `ALLOWED_MIME` must accept whatever it picks.
// The test enumerates every (hasAudio, supports) combination so a future
// branch added to `pickMimeType` is automatically exercised against the
// server's allow-list — closing the silent-drift hazard the author flagged
// in `recorderCapture.js:11–13` ("pure rule referenced cross-tier").
describe('pickMimeType output is a subset of ALLOWED_MIME', () => {
  const TYPED_MIMES = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
  ] as const;

  const subsetsOf = <T>(items: readonly T[]): T[][] => {
    const out: T[][] = [];
    for (let mask = 0; mask < 1 << items.length; mask++) {
      out.push(items.filter((_, i) => (mask >> i) & 1));
    }
    return out;
  };

  const cases = [true, false].flatMap((hasAudio) =>
    subsetsOf(TYPED_MIMES).map((supports) => ({
      hasAudio,
      supports,
      label: supports.length === 0 ? '∅' : supports.join(', '),
    })),
  );

  let supported: Set<string>;

  beforeEach(() => {
    supported = new Set();
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (m: string) => supported.has(m),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(cases)(
    'pickMimeType(hasAudio=$hasAudio, supports={$label}) ∈ ALLOWED_MIME',
    ({ hasAudio, supports }) => {
      for (const m of supports) supported.add(m);
      const result = pickMimeType(hasAudio);
      expect(ALLOWED_MIME).toContain(result);
    },
  );
});

describe('POST /create-upload wire contract', () => {
  it('success response contains exactly { slug, uploadUrl, viewerUrl }', async () => {
    const { app, authStore, cleanup } = buildTestApp();
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm', sizeBytes: 100 });

      expect(res.status).toBe(200);
      const body = res.body as CreateUploadResponse;
      expect(Object.keys(body).sort()).toEqual(
        ['slug', 'uploadUrl', 'viewerUrl'].sort(),
      );
      expect(typeof body.slug).toBe('string');
      expect(typeof body.uploadUrl).toBe('string');
      expect(typeof body.viewerUrl).toBe('string');
    } finally {
      cleanup();
    }
  });

  it('emits every declared CreateUploadErrorCode under the documented condition', async () => {
    // This test is the canonical reachability proof for the union type.
    // If you add a new code to CreateUploadErrorCode, add a case here.
    const declared: CreateUploadErrorCode[] = [
      'invalid_content_type',
      'invalid_size_bytes',
      'file_too_large',
      'upload_mint_failed',
      'internal_server_error',
    ];
    const observed = new Set<string>();

    // unauthenticated — not a CreateUploadErrorCode but we verify it returns 401
    {
      const { app, cleanup } = buildTestApp();
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/webm', sizeBytes: 100 });
        expect(res.status).toBe(401);
      } finally {
        cleanup();
      }
    }

    // invalid_content_type
    {
      const { app, authStore, cleanup } = buildTestApp();
      try {
        const cookie = await signedInCookie(authStore);
        const res = await request(app)
          .post('/create-upload')
          .set('Cookie', cookie)
          .send({ contentType: 'video/mp4', sizeBytes: 100 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // invalid_size_bytes
    {
      const { app, authStore, cleanup } = buildTestApp();
      try {
        const cookie = await signedInCookie(authStore);
        const res = await request(app)
          .post('/create-upload')
          .set('Cookie', cookie)
          .send({ contentType: 'video/webm' });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // file_too_large
    {
      const { app, authStore, cleanup } = buildTestApp({ maxUploadBytes: 1 });
      try {
        const cookie = await signedInCookie(authStore);
        const res = await request(app)
          .post('/create-upload')
          .set('Cookie', cookie)
          .send({ contentType: 'video/webm', sizeBytes: 1024 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // upload_mint_failed (via R2 throwing after the row is written; ADR-0009)
    {
      const { app, authStore, cleanup } = buildTestApp({
        mintUploadUrl: async () => {
          throw new Error('R2 unavailable');
        },
      });
      try {
        const cookie = await signedInCookie(authStore);
        const res = await request(app)
          .post('/create-upload')
          .set('Cookie', cookie)
          .send({ contentType: 'video/webm', sizeBytes: 100 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // internal_server_error (via SlugGenerationExhaustedError bubbling to the
    // global handler in app.ts; the route itself never emits this code — see
    // ADR-0006 — but the wire surface clients see does include it).
    {
      const { app, recordings, authStore, cleanup } = buildTestApp({
        generateSlug: () => 'always',
      });
      try {
        const cookie = await signedInCookie(authStore);
        // Pre-claim the slug; the next /create-upload then exhausts retries.
        await recordings.create({ contentType: 'video/webm', sizeBytes: 1, userId: 'seed-user' });
        const res = await request(app)
          .post('/create-upload')
          .set('Cookie', cookie)
          .send({ contentType: 'video/webm', sizeBytes: 100 });
        expect(res.status).toBe(500);
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    expect([...observed].sort()).toEqual([...declared].sort());
  });
});
