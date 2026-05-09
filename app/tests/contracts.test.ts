import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type {
  CreateUploadResponse,
  CreateUploadErrorCode,
} from '../src/routes/createUpload';
import { ALLOWED_MIME, type AllowedMime } from '../src/recording';
import { buildTestApp } from './helpers/testApp';

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

describe('POST /create-upload wire contract', () => {
  it('success response contains exactly { slug, uploadUrl, viewerUrl }', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
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

    // invalid_content_type
    {
      const { app, cleanup } = buildTestApp();
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/mp4', sizeBytes: 100 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // invalid_size_bytes
    {
      const { app, cleanup } = buildTestApp();
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/webm' });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // file_too_large
    {
      const { app, cleanup } = buildTestApp({ maxUploadBytes: 1 });
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/webm', sizeBytes: 1024 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // upload_mint_failed (via R2 throwing after the row is written; ADR-0009)
    {
      const { app, cleanup } = buildTestApp({
        mintUploadUrl: async () => {
          throw new Error('R2 unavailable');
        },
      });
      try {
        const res = await request(app)
          .post('/create-upload')
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
      const { app, recordings, cleanup } = buildTestApp({
        generateSlug: () => 'always',
      });
      try {
        // Pre-claim the slug; the next /create-upload then exhausts retries.
        await recordings.create({ contentType: 'video/webm', sizeBytes: 1 });
        const res = await request(app)
          .post('/create-upload')
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
