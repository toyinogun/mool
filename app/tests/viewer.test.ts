import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';
import { createApp } from '../src/app';
import { createInMemoryAuthStore } from '../src/auth/authStore';
import { createFakeEmailSender } from '../src/email/sender';
import type { Recordings } from '../src/recording';

const TEST_USER_ID = 'test-user-id';

describe('GET /v/:slug', () => {
  it('mints a signed-GET URL and embeds it in the HTML', async () => {
    // The route projects Recording → { playbackUrl } via mintViewUrl.
    // Default fake mints: https://fake-r2.test/<key>?signed=get&ttl=<ttl>
    const { app, recordings, cleanup } = buildTestApp({
      generateSlug: () => 'abc123',
    });
    try {
      await recordings.create({ contentType: 'video/webm', sizeBytes: 1, userId: TEST_USER_ID });
      const res = await request(app).get('/v/abc123');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/html');
      expect(res.text).toContain('https://fake-r2.test/abc123.webm?signed=get&ttl=3600');
    } finally {
      cleanup();
    }
  });

  it('passes the recording r2Key to mintViewUrl (not the slug)', async () => {
    // Pins the projection's input: the route hands `r2Key` to `mintViewUrl`,
    // not `slug`. v0.5 will diverge these (key format changes per ADR-0002),
    // and conflating them here would silently break.
    const seenKeys: string[] = [];
    const { app, recordings, cleanup } = buildTestApp({
      generateSlug: () => 'abc123',
      mintViewUrl: async ({ key, ttlSeconds }) => {
        seenKeys.push(key);
        return `https://fake-r2.test/${key}?signed=get&ttl=${ttlSeconds}`;
      },
    });
    try {
      await recordings.create({ contentType: 'video/webm', sizeBytes: 1, userId: TEST_USER_ID });
      await request(app).get('/v/abc123');
      expect(seenKeys).toEqual(['abc123.webm']);
    } finally {
      cleanup();
    }
  });

  it('uses the configured viewUrlTtlSeconds when minting the view URL', async () => {
    const { app, recordings, cleanup } = buildTestApp({
      generateSlug: () => 'abc123',
      viewUrlTtlSeconds: 60,
    });
    try {
      await recordings.create({ contentType: 'video/webm', sizeBytes: 1, userId: TEST_USER_ID });
      const res = await request(app).get('/v/abc123');
      expect(res.status).toBe(200);
      expect(res.text).toContain('ttl=60');
    } finally {
      cleanup();
    }
  });

  it('returns 502 plain-text when mintViewUrl rejects', async () => {
    const { app, recordings, cleanup } = buildTestApp({
      generateSlug: () => 'abc123',
      mintViewUrl: async () => {
        throw new Error('R2 signing exploded');
      },
    });
    try {
      await recordings.create({ contentType: 'video/webm', sizeBytes: 1, userId: TEST_USER_ID });
      const res = await request(app).get('/v/abc123');
      expect(res.status).toBe(502);
      expect(res.headers['content-type']).toContain('text/plain');
      expect(res.text).toBe('Recording temporarily unavailable');
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
      listForUser: async () => {
        throw new Error('not exercised in this test');
      },
      deleteForUser: async () => {
        throw new Error('not exercised in this test');
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
      renderLibraryPage: () => {
        throw new Error('renderLibraryPage should not be called in this test');
      },
      deleteObject: async () => {
        throw new Error('deleteObject should not be called in this test');
      },
      mintViewUrl: async () => {
        throw new Error('mintViewUrl should not be called when recordings.get throws');
      },
      viewUrlTtlSeconds: 3600,
      publicDir: null,
      publicAppUrl: 'https://record.example.com',
      signinTokenTtlSeconds: 900,
      sessionTtlSeconds: 2592000,
      cookieSecure: false,
      dbHealth: async () => true,
    });
    const res = await request(app).get('/v/abc123');
    expect(res.status).toBe(500);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).not.toContain('internal_server_error');
  });
});
