import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp, signedInCookie } from './helpers/testApp';
import { createInMemoryAuthStore } from '../src/auth/authStore';

describe('GET /api/recordings', () => {
  it('lists the callers own recordings, newest first', async () => {
    const authStore = createInMemoryAuthStore();
    const { app, cleanup } = buildTestApp({ authStore });
    try {
      const cookie = await signedInCookie(authStore, 'a@b.com');
      for (let i = 0; i < 3; i++) {
        await request(app).post('/create-upload').set('Cookie', cookie)
          .send({ contentType: 'video/webm', sizeBytes: 1000 });
      }
      const r = await request(app).get('/api/recordings?limit=10').set('Cookie', cookie);
      expect(r.status).toBe(200);
      expect(r.body.items.length).toBe(3);
      expect(new Date(r.body.items[0].createdAt) >= new Date(r.body.items[1].createdAt)).toBe(true);
    } finally { cleanup(); }
  });

  it('does not include another users recordings', async () => {
    const authStore = createInMemoryAuthStore();
    const { app, cleanup } = buildTestApp({ authStore });
    try {
      const cookieA = await signedInCookie(authStore, 'a@b.com');
      const cookieB = await signedInCookie(authStore, 'b@b.com');
      await request(app).post('/create-upload').set('Cookie', cookieA).send({ contentType: 'video/webm', sizeBytes: 1 });
      const r = await request(app).get('/api/recordings').set('Cookie', cookieB);
      expect(r.body.items).toEqual([]);
    } finally { cleanup(); }
  });

  it('401 when unauthenticated', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const r = await request(app).get('/api/recordings');
      expect(r.status).toBe(401);
    } finally { cleanup(); }
  });
});
