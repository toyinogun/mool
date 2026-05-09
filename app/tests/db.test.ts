import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';

describe('openDb', () => {
  it('round-trips a recording', () => {
    const db = openDb(':memory:');
    db.insertRecording({
      slug: 'abc123',
      r2Key: 'abc123.webm',
      mimeType: 'video/webm',
      createdAt: 1_700_000_000_000,
    });
    expect(db.getRecording('abc123')).toEqual({
      slug: 'abc123',
      r2Key: 'abc123.webm',
      mimeType: 'video/webm',
      createdAt: 1_700_000_000_000,
    });
    db.close();
  });

  it('returns null for an unknown slug', () => {
    const db = openDb(':memory:');
    expect(db.getRecording('missing')).toBeNull();
    db.close();
  });

  it('throws on duplicate slug (PRIMARY KEY constraint)', () => {
    const db = openDb(':memory:');
    const rec = {
      slug: 'dup001',
      r2Key: 'dup001.webm',
      mimeType: 'video/webm',
      createdAt: 1,
    };
    db.insertRecording(rec);
    let caught: Error | null = null;
    try {
      db.insertRecording(rec);
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect((caught as { code?: string }).code).toBe('SQLITE_CONSTRAINT_PRIMARYKEY');
    db.close();
  });
});
