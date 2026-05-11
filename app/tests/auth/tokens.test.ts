import { describe, it, expect } from 'vitest';
import { generateToken, hashToken, safeEqual } from '../../src/auth/tokens';

describe('generateToken', () => {
  it('returns a base64url string of length 43', () => {
    const t = generateToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('produces distinct values across calls', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });
});

describe('hashToken', () => {
  it('returns a Buffer of length 32 (SHA-256)', () => {
    const h = hashToken('any-input');
    expect(h).toBeInstanceOf(Buffer);
    expect(h.length).toBe(32);
  });

  it('is deterministic', () => {
    expect(hashToken('x').equals(hashToken('x'))).toBe(true);
  });

  it('differs for different inputs', () => {
    expect(hashToken('a').equals(hashToken('b'))).toBe(false);
  });
});

describe('safeEqual', () => {
  it('returns true for equal buffers', () => {
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abc'))).toBe(true);
  });

  it('returns false for differing buffers', () => {
    expect(safeEqual(Buffer.from('abc'), Buffer.from('xyz'))).toBe(false);
  });

  it('returns false for different-length buffers', () => {
    expect(safeEqual(Buffer.from('abc'), Buffer.from('abcd'))).toBe(false);
  });
});
