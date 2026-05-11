import { describe, it, expect } from 'vitest';
import { sessionCookieAttributes } from '../../src/auth/cookies';

describe('sessionCookieAttributes', () => {
  it('produces an HttpOnly, SameSite=Lax, Path=/ cookie', () => {
    const attrs = sessionCookieAttributes({ maxAgeSeconds: 3600, secure: true });
    expect(attrs.httpOnly).toBe(true);
    expect(attrs.sameSite).toBe('lax');
    expect(attrs.path).toBe('/');
    expect(attrs.secure).toBe(true);
    expect(attrs.maxAge).toBe(3600_000);
  });

  it('honors secure=false (for local dev)', () => {
    expect(sessionCookieAttributes({ maxAgeSeconds: 60, secure: false }).secure).toBe(false);
  });

  it('produces a max-age-zero clear attribute set', () => {
    const attrs = sessionCookieAttributes({ maxAgeSeconds: 0, secure: true });
    expect(attrs.maxAge).toBe(0);
  });
});
