import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';
import { generateToken, hashToken } from '../src/auth/tokens';
import { createInMemoryAuthStore } from '../src/auth/authStore';
import { SESSION_COOKIE_NAME } from '../src/auth/cookies';

describe('POST /auth/signout', () => {
  it('deletes the session, clears the cookie, redirects to /signin', async () => {
    const store = createInMemoryAuthStore();
    const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
    const raw = generateToken();
    await store.insertSession({ tokenHash: hashToken(raw), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    const { app, cleanup } = buildTestApp({ authStore: store });
    try {
      const r = await request(app)
        .post('/auth/signout')
        .set('Cookie', `${SESSION_COOKIE_NAME}=${raw}`);
      expect(r.status).toBe(302);
      expect(r.header['location']).toBe('/signin');
      expect(r.header['set-cookie'][0]).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=;`));
      expect(await store.findSessionByHash(hashToken(raw))).toBeNull();
    } finally { cleanup(); }
  });

  it('redirects even when not signed in (idempotent)', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const r = await request(app).post('/auth/signout');
      expect(r.status).toBe(302);
      expect(r.header['location']).toBe('/signin');
    } finally { cleanup(); }
  });
});
