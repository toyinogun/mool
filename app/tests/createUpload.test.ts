import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp, signedInCookie } from './helpers/testApp';

describe('POST /create-upload', () => {
  it('returns 401 when unauthenticated', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 12_345 });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('unauthenticated');
    } finally {
      cleanup();
    }
  });

  it('returns slug, uploadUrl, and viewerUrl on success', async () => {
    const { app, recordings, authStore, cleanup } = buildTestApp();
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm', sizeBytes: 12_345 });

      expect(res.status).toBe(200);
      expect(res.body.slug).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(res.body.uploadUrl).toContain(`${res.body.slug}.webm`);
      expect(res.body.viewerUrl).toBe(
        `https://record.example.com/v/${res.body.slug}`,
      );
      expect(await recordings.get(res.body.slug)).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('rejects unknown content types with 400', async () => {
    const { app, authStore, cleanup } = buildTestApp();
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/mp4', sizeBytes: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_content_type');
    } finally {
      cleanup();
    }
  });

  it('accepts video/webm with codec parameter (e.g. video/webm;codecs=vp9) and round-trips it to R2', async () => {
    const seenContentTypes: string[] = [];
    const { app, authStore, cleanup } = buildTestApp({
      mintUploadUrl: async ({ key, contentType }) => {
        seenContentTypes.push(contentType);
        return `https://fake-r2.test/${key}?signed=1`;
      },
    });
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm;codecs=vp9', sizeBytes: 100 });
      expect(res.status).toBe(200);
      expect(seenContentTypes).toEqual(['video/webm;codecs=vp9']);
    } finally {
      cleanup();
    }
  });

  it('accepts video/webm;codecs=vp9,opus (v0.2 mic-enabled) and round-trips it to R2', async () => {
    const seenContentTypes: string[] = [];
    const { app, authStore, cleanup } = buildTestApp({
      mintUploadUrl: async ({ key, contentType }) => {
        seenContentTypes.push(contentType);
        return `https://fake-r2.test/${key}?signed=1`;
      },
    });
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm;codecs=vp9,opus', sizeBytes: 100 });
      expect(res.status).toBe(200);
      expect(seenContentTypes).toEqual(['video/webm;codecs=vp9,opus']);
    } finally {
      cleanup();
    }
  });

  it('rejects missing sizeBytes with 400', async () => {
    const { app, authStore, cleanup } = buildTestApp();
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects sizeBytes <= 0 with 400', async () => {
    const { app, authStore, cleanup } = buildTestApp();
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm', sizeBytes: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects non-integer sizeBytes with 400', async () => {
    const { app, authStore, cleanup } = buildTestApp();
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm', sizeBytes: 1.5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects sizeBytes over the cap with 413', async () => {
    const { app, authStore, cleanup } = buildTestApp({ maxUploadBytes: 1024 });
    try {
      const cookie = await signedInCookie(authStore);
      const res = await request(app)
        .post('/create-upload')
        .set('Cookie', cookie)
        .send({ contentType: 'video/webm', sizeBytes: 2048 });
      expect(res.status).toBe(413);
      expect(res.body.error).toBe('file_too_large');
      expect(res.body.maxBytes).toBe(1024);
    } finally {
      cleanup();
    }
  });

  it('returns 502 upload_mint_failed when mintUploadUrl rejects (orphan-row case, ADR-0009)', async () => {
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
      expect(res.status).toBe(502);
      expect(res.body.error).toBe('upload_mint_failed');
    } finally {
      cleanup();
    }
  });
});
