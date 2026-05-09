import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';
import { createApp } from '../src/app';
import type { Recordings } from '../src/recording';

describe('GET /v/:slug', () => {
  it('returns HTML containing the public R2 URL for an existing slug', async () => {
    const { app, recordings, cleanup } = buildTestApp({
      generateSlug: () => 'abc123',
    });
    try {
      await recordings.create({ contentType: 'video/webm', sizeBytes: 1 });
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

  it('returns plain-text 500 (not JSON) when recordings.get throws', async () => {
    const failingRecordings: Recordings = {
      create: async () => {
        throw new Error('not exercised in this test');
      },
      get: async () => {
        throw new Error('DB exploded');
      },
      close: () => {},
    };
    const app = createApp({
      recordings: failingRecordings,
      maxUploadBytes: 1024,
      viewerTemplate: '<!doctype html><html><body><video src="{{PLAYBACK_URL}}"></video></body></html>',
      publicDir: null,
    });
    const res = await request(app).get('/v/abc123');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).not.toContain('internal_server_error');
  });
});
