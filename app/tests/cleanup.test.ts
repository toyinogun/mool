import { describe, it, expect } from 'vitest';
import { startCleanupLoop } from '../src/cleanup';
import { createInMemoryAuthStore } from '../src/auth/authStore';
import { hashToken } from '../src/auth/tokens';

describe('startCleanupLoop', () => {
  it('removes expired sessions and signin tokens past the grace period', async () => {
    const store = createInMemoryAuthStore();
    const user = await store.upsertUserByEmail({ email: 'a@b.com', displayName: 'a' });
    // Two sessions: one expired beyond grace, one current
    await store.insertSession({
      tokenHash: hashToken('old'),
      userId: user.id,
      expiresAt: new Date(Date.now() - 10 * 24 * 3600_000), // 10 days ago — past 7d grace
    });
    await store.insertSession({
      tokenHash: hashToken('fresh'),
      userId: user.id,
      expiresAt: new Date(Date.now() + 1 * 24 * 3600_000),
    });
    // Two signin tokens: one expired-and-past-grace, one current
    await store.insertSigninToken({
      tokenHash: hashToken('old-st'),
      email: 'a@b.com',
      expiresAt: new Date(Date.now() - 10 * 24 * 3600_000),
    });
    await store.insertSigninToken({
      tokenHash: hashToken('fresh-st'),
      email: 'a@b.com',
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });

    const loop = startCleanupLoop({ authStore: store, graceSeconds: 7 * 24 * 3600 });
    // Let the initial tick run
    await new Promise((r) => setTimeout(r, 10));
    loop.stop();

    expect(await store.findSessionByHash(hashToken('old'))).toBeNull();
    // 'fresh' session: expiresAt in the future, it will still be found
    expect(await store.findSessionByHash(hashToken('fresh'))).not.toBeNull();
    expect(await store.findSigninTokenByHash(hashToken('old-st'))).toBeNull();
    expect(await store.findSigninTokenByHash(hashToken('fresh-st'))).not.toBeNull();
  });
});
