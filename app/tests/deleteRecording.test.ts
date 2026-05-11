import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp, signedInCookie } from './helpers/testApp';
import { createInMemoryAuthStore } from '../src/auth/authStore';

describe('DELETE /recordings/:slug', () => {
  it('owner: deletes the R2 object and the row, returns 204', async () => {
    const authStore = createInMemoryAuthStore();
    const deletedKeys: string[] = [];
    const { app, cleanup } = buildTestApp({
      authStore,
      deleteObject: async (key: string) => { deletedKeys.push(key); },
    });
    try {
      const cookie = await signedInCookie(authStore, 'a@b.com');
      const created = await request(app).post('/create-upload').set('Cookie', cookie)
        .send({ contentType: 'video/webm', sizeBytes: 1000 });
      const slug = created.body.slug;
      const r = await request(app).delete(`/recordings/${slug}`).set('Cookie', cookie);
      expect(r.status).toBe(204);
      expect(deletedKeys).toEqual([`${slug}.webm`]);
      const after = await request(app).get('/api/recordings').set('Cookie', cookie);
      expect(after.body.items).toEqual([]);
    } finally { cleanup(); }
  });

  it('non-owner: 404 (does not leak existence)', async () => {
    const authStore = createInMemoryAuthStore();
    const { app, cleanup } = buildTestApp({ authStore });
    try {
      const cookieA = await signedInCookie(authStore, 'a@b.com');
      const cookieB = await signedInCookie(authStore, 'b@b.com');
      const created = await request(app).post('/create-upload').set('Cookie', cookieA).send({ contentType: 'video/webm', sizeBytes: 1 });
      const r = await request(app).delete(`/recordings/${created.body.slug}`).set('Cookie', cookieB);
      expect(r.status).toBe(404);
    } finally { cleanup(); }
  });

  it('R2 delete failure: returns 502, row is NOT removed', async () => {
    const authStore = createInMemoryAuthStore();
    const { app, cleanup } = buildTestApp({
      authStore,
      deleteObject: async () => { throw new Error('r2-down'); },
    });
    try {
      const cookie = await signedInCookie(authStore, 'a@b.com');
      const created = await request(app).post('/create-upload').set('Cookie', cookie).send({ contentType: 'video/webm', sizeBytes: 1 });
      const r = await request(app).delete(`/recordings/${created.body.slug}`).set('Cookie', cookie);
      expect(r.status).toBe(502);
      const after = await request(app).get('/api/recordings').set('Cookie', cookie);
      expect(after.body.items.length).toBe(1);
    } finally { cleanup(); }
  });
});
