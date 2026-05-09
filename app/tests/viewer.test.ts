import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';

describe('GET /v/:slug', () => {
  it('returns HTML containing the public R2 URL for an existing slug', async () => {
    const { app, db, cleanup } = buildTestApp();
    try {
      db.insertRecording({
        slug: 'abc123',
        r2Key: 'abc123.webm',
        mimeType: 'video/webm',
        createdAt: Date.now(),
      });
      const res = await request(app).get('/v/abc123');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('https://videos.example.com/abc123.webm');
      // Pin: no `{{IDENT}}` placeholder survived substitution. Closes the
      // silent-typo hazard if a future placeholder is added to viewer.html
      // but the route forgets to wire it up.
      expect(res.text).not.toMatch(/\{\{[A-Z_]+\}\}/);
    } finally {
      cleanup();
    }
  });

  it('returns 404 for a syntactically valid but unknown slug', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app).get('/v/zzzzzz');
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });

  it('returns 404 for a malformed slug (wrong shape)', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app).get('/v/!!');
      expect(res.status).toBe(404);
    } finally {
      cleanup();
    }
  });
});
