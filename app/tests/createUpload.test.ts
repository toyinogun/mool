import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp, fakeR2 } from './helpers/testApp';
import { createApp } from '../src/app';
import { openDb } from '../src/db';

describe('POST /create-upload', () => {
  it('returns slug, uploadUrl, and viewerUrl on success', async () => {
    const { app, db, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 12_345 });

      expect(res.status).toBe(200);
      expect(res.body.slug).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(res.body.uploadUrl).toContain(`${res.body.slug}.webm`);
      expect(res.body.viewerUrl).toBe(
        `https://record.example.com/v/${res.body.slug}`,
      );
      expect(db.getRecording(res.body.slug)).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('persists the recording with the expected r2Key', async () => {
    const { app, db, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 100 });

      const rec = db.getRecording(res.body.slug);
      expect(rec).toMatchObject({
        slug: res.body.slug,
        r2Key: `${res.body.slug}.webm`,
        mimeType: 'video/webm',
      });
    } finally {
      cleanup();
    }
  });

  it('rejects unknown content types with 400', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/mp4', sizeBytes: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_content_type');
    } finally {
      cleanup();
    }
  });

  it('accepts video/webm with codec parameter (e.g. video/webm;codecs=vp9)', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm;codecs=vp9', sizeBytes: 100 });
      expect(res.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it('rejects missing sizeBytes with 400', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects sizeBytes <= 0 with 400', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects sizeBytes over the cap with 413', async () => {
    const { app, cleanup } = buildTestApp({ maxUploadBytes: 1024 });
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 2048 });
      expect(res.status).toBe(413);
      expect(res.body.error).toBe('file_too_large');
      expect(res.body.maxBytes).toBe(1024);
    } finally {
      cleanup();
    }
  });

  it('returns 500 (not hang) when R2 minting fails', async () => {
    // Verifies the asyncRoute wrapper + error middleware catch R2 rejections.
    const db = openDb(':memory:');
    const failingR2 = {
      ...fakeR2(),
      async mintUploadUrl(): Promise<string> {
        throw new Error('R2 unavailable');
      },
    };
    const app = createApp({
      db,
      r2: failingR2,
      maxUploadBytes: 500 * 1024 * 1024,
      publicAppUrl: 'https://record.example.com',
      viewerTemplate: '<html></html>',
      publicDir: null,
    });
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 100 });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('internal_server_error');
    } finally {
      db.close();
    }
  });
});
