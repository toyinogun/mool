import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';
import { generateToken, hashToken } from '../src/auth/tokens';
import { createInMemoryAuthStore } from '../src/auth/authStore';
import { SESSION_COOKIE_NAME } from '../src/auth/cookies';

describe('GET /auth/callback', () => {
  it('with a valid unconsumed token: upserts user, creates session, sets cookie, 302s to /', async () => {
    const store = createInMemoryAuthStore();
    const token = generateToken();
    await store.insertSigninToken({
      tokenHash: hashToken(token),
      email: 'a@b.com',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const { app, cleanup } = buildTestApp({ authStore: store });
    try {
      const r = await request(app).get(`/auth/callback?token=${token}`);
      expect(r.status).toBe(302);
      expect(r.header['location']).toBe('/');
      const setCookie = r.header['set-cookie'][0];
      expect(setCookie).toMatch(new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{43}`));
      expect(setCookie).toMatch(/HttpOnly/i);
      expect(setCookie).toMatch(/SameSite=Lax/i);

      const user = (await store.findUserById((await store.findSessionByHash(hashToken(setCookie.split('=')[1].split(';')[0])))!.user.id))!;
      expect(user.email).toBe('a@b.com');
      expect(user.displayName).toBe('a');
    } finally { cleanup(); }
  });

  it('expired token → invalid page', async () => {
    const store = createInMemoryAuthStore();
    const token = generateToken();
    await store.insertSigninToken({
      tokenHash: hashToken(token), email: 'a@b.com',
      expiresAt: new Date(Date.now() - 1_000),
    });
    const { app, cleanup } = buildTestApp({ authStore: store });
    try {
      const r = await request(app).get(`/auth/callback?token=${token}`);
      expect(r.status).toBe(400);
      expect(r.text).toMatch(/invalid or expired/i);
    } finally { cleanup(); }
  });

  it('already-consumed token → invalid page', async () => {
    const store = createInMemoryAuthStore();
    const token = generateToken();
    await store.insertSigninToken({
      tokenHash: hashToken(token), email: 'a@b.com',
      expiresAt: new Date(Date.now() + 60_000),
    });
    await store.consumeSigninToken(hashToken(token));
    const { app, cleanup } = buildTestApp({ authStore: store });
    try {
      const r = await request(app).get(`/auth/callback?token=${token}`);
      expect(r.status).toBe(400);
    } finally { cleanup(); }
  });

  it('unknown token → invalid page', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const r = await request(app).get(`/auth/callback?token=${generateToken()}`);
      expect(r.status).toBe(400);
    } finally { cleanup(); }
  });
});
