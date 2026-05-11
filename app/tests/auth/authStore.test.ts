import { describe, it, expect, beforeEach } from 'vitest';
import { createInMemoryAuthStore, type AuthStore } from '../../src/auth/authStore';
import { hashToken } from '../../src/auth/tokens';

describe('AuthStore (in-memory)', () => {
  let store: AuthStore;
  beforeEach(() => { store = createInMemoryAuthStore({ now: () => new Date('2026-01-01T00:00:00Z') }); });

  describe('users', () => {
    it('upserts a new user, then finds them by email', async () => {
      const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
      expect(user.email).toBe('a@b.com');
      expect(user.displayName).toBe('a');
      expect(user.id).toMatch(/^[0-9a-f-]{36}$/);

      const found = await store.findUserById(user.id);
      expect(found?.email).toBe('a@b.com');
    });

    it('upsertUserByEmail returns the existing row if email already exists (does not overwrite display_name)', async () => {
      const u1 = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'first' });
      const u2 = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'second' });
      expect(u2.id).toBe(u1.id);
      expect(u2.displayName).toBe('first');
    });

    it('upsertUserByEmail bumps updatedAt; findUserById returns the bumped row', async () => {
      let nowVal = new Date('2026-01-01T00:00:00Z');
      const store2 = createInMemoryAuthStore({ now: () => nowVal });
      const u1 = await store2.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
      nowVal = new Date('2026-01-02T00:00:00Z');
      const u2 = await store2.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
      expect(u2.updatedAt).toEqual(new Date('2026-01-02T00:00:00Z'));
      const found = await store2.findUserById(u1.id);
      expect(found?.updatedAt).toEqual(new Date('2026-01-02T00:00:00Z'));
    });
  });

  describe('signin tokens', () => {
    it('inserts, finds by hash, marks consumed', async () => {
      const hash = hashToken('raw');
      await store.insertSigninToken({ tokenHash: hash, email: 'a@b.com', expiresAt: new Date('2026-01-01T00:15:00Z') });

      const found = await store.findSigninTokenByHash(hash);
      expect(found?.email).toBe('a@b.com');
      expect(found?.consumedAt).toBeNull();

      await store.consumeSigninToken(hash);
      const after = await store.findSigninTokenByHash(hash);
      expect(after?.consumedAt).toEqual(new Date('2026-01-01T00:00:00Z'));
    });

    it('deleteUnconsumedSigninTokensForEmail removes pending rows for an email', async () => {
      await store.insertSigninToken({ tokenHash: hashToken('a'), email: 'x@y.com', expiresAt: new Date('2026-01-01T00:15:00Z') });
      await store.insertSigninToken({ tokenHash: hashToken('b'), email: 'x@y.com', expiresAt: new Date('2026-01-01T00:15:00Z') });
      await store.insertSigninToken({ tokenHash: hashToken('c'), email: 'other@y.com', expiresAt: new Date('2026-01-01T00:15:00Z') });

      await store.deleteUnconsumedSigninTokensForEmail('x@y.com');

      expect(await store.findSigninTokenByHash(hashToken('a'))).toBeNull();
      expect(await store.findSigninTokenByHash(hashToken('b'))).toBeNull();
      expect(await store.findSigninTokenByHash(hashToken('c'))).not.toBeNull();
    });
  });

  describe('sessions', () => {
    it('inserts, finds by hash with user joined, and deletes', async () => {
      const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
      const hash = hashToken('s');
      await store.insertSession({ tokenHash: hash, userId: user.id, expiresAt: new Date('2026-02-01T00:00:00Z') });

      const session = await store.findSessionByHash(hash);
      expect(session?.user.email).toBe('a@b.com');
      expect(session?.expiresAt).toEqual(new Date('2026-02-01T00:00:00Z'));

      await store.deleteSession(hash);
      expect(await store.findSessionByHash(hash)).toBeNull();
    });

    it('findSessionByHash skips expired rows', async () => {
      const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
      await store.insertSession({ tokenHash: hashToken('old'), userId: user.id, expiresAt: new Date('2025-12-01T00:00:00Z') });
      expect(await store.findSessionByHash(hashToken('old'))).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('deleteExpired removes only rows whose expires_at is < cutoff', async () => {
      const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
      await store.insertSession({ tokenHash: hashToken('a'), userId: user.id, expiresAt: new Date('2025-11-01T00:00:00Z') });
      await store.insertSession({ tokenHash: hashToken('b'), userId: user.id, expiresAt: new Date('2026-06-01T00:00:00Z') });
      await store.insertSigninToken({ tokenHash: hashToken('s1'), email: 'x@y.com', expiresAt: new Date('2025-11-01T00:00:00Z') });
      await store.insertSigninToken({ tokenHash: hashToken('s2'), email: 'x@y.com', expiresAt: new Date('2026-06-01T00:00:00Z') });

      const removed = await store.deleteExpired({ cutoff: new Date('2025-12-15T00:00:00Z') });
      expect(removed.sessions).toBe(1);
      expect(removed.signinTokens).toBe(1);
    });
  });
});
