import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp, signedInCookie } from './helpers/testApp';
import { createInMemoryAuthStore } from '../src/auth/authStore';

describe('GET /library', () => {
  it('renders HTML containing a JSON island for the callers recordings', async () => {
    const authStore = createInMemoryAuthStore();
    const { app, cleanup } = buildTestApp({ authStore });
    try {
      const cookie = await signedInCookie(authStore, 'a@b.com');
      await request(app).post('/create-upload').set('Cookie', cookie).send({ contentType: 'video/webm', sizeBytes: 1 });
      const r = await request(app).get('/library').set('Cookie', cookie);
      expect(r.status).toBe(200);
      expect(r.header['content-type']).toMatch(/text\/html/);
      expect(r.text).toMatch(/<script id="library-data"/);
      expect(r.text).toMatch(/"slug":/);
    } finally { cleanup(); }
  });

  it('302s to /signin when unauthenticated', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const r = await request(app).get('/library');
      expect(r.status).toBe(302);
      expect(r.header['location']).toMatch(/\/signin$/);
    } finally { cleanup(); }
  });
});
