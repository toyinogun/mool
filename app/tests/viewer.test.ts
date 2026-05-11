import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';
import { createApp } from '../src/app';
import { createInMemoryAuthStore } from '../src/auth/authStore';
import { createFakeEmailSender } from '../src/email/sender';
import type { Recordings } from '../src/recording';

describe('GET /v/:slug', () => {
  it('composes the playback URL from publicUrl(r2Key) and embeds it in the HTML', async () => {
    // The route projects Recording → { playbackUrl } per ADR-0015. This is the
    // canonical pin for that projection: previously the composition lived in
    // the Recording module's `get` and was tested in tests/recording.test.ts.
    const { app, recordings, cleanup } = buildTestApp({
      generateSlug: () => 'abc123',
    });
    try {
      await recordings.create({ contentType: 'video/webm', sizeBytes: 1 });
      const res = await request(app).get('/v/abc123');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('https://videos.example.com/abc123.webm');
    } finally {
      cleanup();
    }
  });

  it('passes the recording r2Key to publicUrl (not the slug)', async () => {
    // Pins the projection's input: the route hands `r2Key` to `publicUrl`,
    // not `slug`. v0.5 will diverge these (key format changes per ADR-0002),
    // and conflating them here would silently break.
    const seenKeys: string[] = [];
    const { app, recordings, cleanup } = buildTestApp({
      generateSlug: () => 'abc123',
      publicUrl: (key) => {
        seenKeys.push(key);
        return `https://videos.example.com/${key}`;
      },
    });
    try {
      await recordings.create({ contentType: 'video/webm', sizeBytes: 1 });
      await request(app).get('/v/abc123');
      expect(seenKeys).toEqual(['abc123.webm']);
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
      authStore: createInMemoryAuthStore(),
      emailSender: createFakeEmailSender(),
      maxUploadBytes: 1024,
      renderViewerPage: () => {
        throw new Error('renderViewerPage should not be called when recordings.get throws');
      },
      publicUrl: () => {
        throw new Error('publicUrl should not be called when recordings.get throws');
      },
      publicDir: null,
      publicAppUrl: 'https://record.example.com',
      signinTokenTtlSeconds: 900,
    });
    const res = await request(app).get('/v/abc123');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).not.toContain('internal_server_error');
  });
});
