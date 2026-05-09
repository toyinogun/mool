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
    expect(ALLOWED_MIME).toEqual(['video/webm', 'video/webm;codecs=vp9']);
    // Frozen so the route cannot mutate the contract at runtime.
    expect(Object.isFrozen(ALLOWED_MIME)).toBe(true);
    // Type-level: AllowedMime narrows to the same literals (compile-time check).
    const sample: AllowedMime = 'video/webm;codecs=vp9';
    expect(ALLOWED_MIME).toContain(sample);
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

    // internal_server_error (via failing R2)
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

    expect([...observed].sort()).toEqual([...declared].sort());
  });
});
