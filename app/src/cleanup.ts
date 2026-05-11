import type { AuthStore } from './auth/authStore';

export interface CleanupDeps {
  authStore: AuthStore;
  /** Grace period past `expires_at` before deletion. Default 7 days. */
  graceSeconds?: number;
}

export interface CleanupLoop { stop: () => void; }

export function startCleanupLoop(deps: CleanupDeps, intervalMs = 3_600_000): CleanupLoop {
  const grace = (deps.graceSeconds ?? 7 * 24 * 3600) * 1000;
  const tick = async () => {
    const cutoff = new Date(Date.now() - grace);
    try {
      await deps.authStore.deleteExpired({ cutoff });
    } catch (err) {
      console.error('cleanup failed', err);
    }
  };
  // First sweep on startup, then on interval.
  void tick();
  const handle = setInterval(() => { void tick(); }, intervalMs).unref();
  return { stop: () => clearInterval(handle) };
}
