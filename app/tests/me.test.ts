import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';
import { generateToken, hashToken } from '../src/auth/tokens';
import { createInMemoryAuthStore } from '../src/auth/authStore';
import { SESSION_COOKIE_NAME } from '../src/auth/cookies';

describe('GET /me', () => {
  it('returns 401 when not signed in', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const r = await request(app).get('/me');
      expect(r.status).toBe(401);
      expect(r.body).toEqual({ error: 'unauthenticated' });
    } finally { cleanup(); }
  });

  it('returns {id, email, displayName} when signed in', async () => {
    const store = createInMemoryAuthStore();
    const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
    const raw = generateToken();
    await store.insertSession({ tokenHash: hashToken(raw), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    const { app, cleanup } = buildTestApp({ authStore: store });
    try {
      const r = await request(app).get('/me').set('Cookie', `${SESSION_COOKIE_NAME}=${raw}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id: user.id, email: 'a@b.com', displayName: 'a' });
    } finally { cleanup(); }
  });
});
