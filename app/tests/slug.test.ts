import { describe, it, expect } from 'vitest';
import { generateSlug } from '../src/slug';

describe('generateSlug', () => {
  it('returns a 6-character string', () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(6);
  });

  it('uses only base62 characters (A-Z, a-z, 0-9)', () => {
    for (let i = 0; i < 200; i++) {
      expect(generateSlug()).toMatch(/^[A-Za-z0-9]{6}$/);
    }
  });

  it('produces highly unique values', () => {
    const slugs = new Set<string>();
    for (let i = 0; i < 1000; i++) slugs.add(generateSlug());
    expect(slugs.size).toBeGreaterThan(990);
  });
});
