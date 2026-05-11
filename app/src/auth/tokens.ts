import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** A 32-byte random token, encoded as base64url (no padding) — 43 chars. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 hash of the token, returned as raw bytes (Buffer of length 32). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}

/** Constant-time comparison of two buffers. Returns false if lengths differ. */
export function safeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
