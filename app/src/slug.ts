import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const SLUG_LENGTH = 6;

export function generateSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let out = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}
