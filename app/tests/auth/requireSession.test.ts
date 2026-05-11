import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { createInMemoryAuthStore, type AuthStore } from '../../src/auth/authStore';
import { requireSession } from '../../src/auth/requireSession';
import { hashToken } from '../../src/auth/tokens';
import { SESSION_COOKIE_NAME } from '../../src/auth/cookies';

function makeApp(mode: 'html' | 'json', store: AuthStore) {
  const app = express();
  app.use(cookieParser());
  app.get(
    '/protected',
    requireSession({ authStore: store, mode, signinUrl: 'https://record.example.com/signin' }),
    (req, res) => res.json({ userId: req.user!.id, email: req.user!.email }),
  );
  return app;
}

describe('requireSession (html mode)', () => {
  let store: AuthStore;
  beforeEach(() => { store = createInMemoryAuthStore(); });

  it('302s to the signin url when no cookie', async () => {
    const r = await request(makeApp('html', store)).get('/protected');
    expect(r.status).toBe(302);
    expect(r.header['location']).toBe('https://record.example.com/signin');
  });

  it('302s when cookie value does not match any session', async () => {
    const r = await request(makeApp('html', store))
      .get('/protected')
      .set('Cookie', `${SESSION_COOKIE_NAME}=bogus`);
    expect(r.status).toBe(302);
  });

  it('passes through and attaches req.user when cookie matches a live session', async () => {
    const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
    const raw = 'rawtoken';
    await store.insertSession({ tokenHash: hashToken(raw), userId: user.id, expiresAt: new Date(Date.now() + 60_000) });
    const r = await request(makeApp('html', store))
      .get('/protected')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${raw}`);
    expect(r.status).toBe(200);
    expect(r.body.email).toBe('a@b.com');
  });

  it('302s when the session has expired', async () => {
    const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
    const raw = 'expiredtoken';
    await store.insertSession({
      tokenHash: hashToken(raw),
      userId: user.id,
      expiresAt: new Date(Date.now() - 60_000), // 60s in the past
    });
    const r = await request(makeApp('html', store))
      .get('/protected')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${raw}`);
    expect(r.status).toBe(302);
    expect(r.header['location']).toBe('https://record.example.com/signin');
  });
});

describe('requireSession (json mode)', () => {
  it('returns 401 when no cookie', async () => {
    const store = createInMemoryAuthStore();
    const r = await request(makeApp('json', store)).get('/protected');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({ error: 'unauthenticated' });
  });
});
