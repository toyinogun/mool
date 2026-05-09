import { describe, it, expect } from 'vitest';
import { openDb } from '../src/db';
import { createRecordings, isValidSlug, SLUG_LENGTH } from '../src/recording';
import type { R2 } from '../src/r2';

function fakeR2(): R2 {
  return {
    async mintUploadUrl({ key }) {
      return `https://fake-r2.test/${key}?signed=1`;
    },
    publicUrl(key) {
      return `https://videos.example.com/${key}`;
    },
  };
}

const PUBLIC_APP_URL = 'https://record.example.com';

describe('createRecordings.create', () => {
  it('returns slug, uploadUrl, and viewerUrl', async () => {
    const db = openDb(':memory:');
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
    });

    const result = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 12_345,
    });

    expect(result.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(result.uploadUrl).toBe(`https://fake-r2.test/${result.slug}.webm?signed=1`);
    expect(result.viewerUrl).toBe(`${PUBLIC_APP_URL}/v/${result.slug}`);
    db.close();
  });

  it('persists a row whose r2Key matches `<slug>.webm`', async () => {
    const db = openDb(':memory:');
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
    });

    const { slug } = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 100,
    });

    const row = db.getRecording(slug);
    expect(row).toMatchObject({
      slug,
      r2Key: `${slug}.webm`,
      mimeType: 'video/webm',
    });
    db.close();
  });

  it('strips a trailing slash from publicAppUrl when building viewerUrl', async () => {
    const db = openDb(':memory:');
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: 'https://record.example.com/',
    });

    const { slug, viewerUrl } = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 100,
    });

    expect(viewerUrl).toBe(`https://record.example.com/v/${slug}`);
    db.close();
  });
});

describe('createRecordings.get', () => {
  it('returns the recording with its viewer-side URLs for a known slug', async () => {
    const db = openDb(':memory:');
    db.insertRecording({
      slug: 'abc123',
      r2Key: 'abc123.webm',
      mimeType: 'video/webm',
      createdAt: 1,
    });
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
    });

    const got = recordings.get('abc123');

    expect(got).not.toBeNull();
    expect(got!.slug).toBe('abc123');
    expect(got!.videoUrl).toBe('https://videos.example.com/abc123.webm');
    db.close();
  });

  it('returns null for an unknown slug', () => {
    const db = openDb(':memory:');
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
    });

    expect(recordings.get('zzzzzz')).toBeNull();
    db.close();
  });

  it('returns null for a malformed slug without touching db', () => {
    const db = openDb(':memory:');
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
    });

    expect(recordings.get('!!')).toBeNull();
    expect(recordings.get('toolong')).toBeNull();
    db.close();
  });
});

describe('isValidSlug', () => {
  it('accepts a 6-character base62 string', () => {
    expect(isValidSlug('abc123')).toBe(true);
    expect(isValidSlug('AaZz09')).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isValidSlug('abc12')).toBe(false);
    expect(isValidSlug('abc1234')).toBe(false);
    expect(isValidSlug('')).toBe(false);
  });

  it('rejects non-base62 characters', () => {
    expect(isValidSlug('abc-12')).toBe(false);
    expect(isValidSlug('abc 12')).toBe(false);
    expect(isValidSlug('abc!23')).toBe(false);
  });
});

describe('slug generation (via create)', () => {
  it('produces highly unique slugs over many invocations', async () => {
    const db = openDb(':memory:');
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
    });

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { slug } = await recordings.create({
        contentType: 'video/webm',
        sizeBytes: 1,
      });
      expect(slug).toMatch(/^[A-Za-z0-9]{6}$/);
      seen.add(slug);
    }
    expect(seen.size).toBeGreaterThan(195);
    db.close();
  });
});

describe('SLUG_LENGTH', () => {
  it('is 6', () => {
    expect(SLUG_LENGTH).toBe(6);
  });
});

describe('createRecordings.create slug collision retry', () => {
  it('retries when the generator returns a duplicate slug, then succeeds', async () => {
    const db = openDb(':memory:');
    db.insertRecording({
      slug: 'taken1',
      r2Key: 'taken1.webm',
      mimeType: 'video/webm',
      createdAt: 1,
    });

    const slugs = ['taken1', 'fresh2'];
    let i = 0;
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
      generateSlug: () => slugs[i++],
    });

    const result = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 100,
    });

    expect(result.slug).toBe('fresh2');
    expect(i).toBe(2); // generator was called twice
    expect(db.getRecording('fresh2')).not.toBeNull();
    expect(db.getRecording('fresh2')!.r2Key).toBe('fresh2.webm');
    db.close();
  });

  it('throws after exhausting MAX_SLUG_TRIES (5) collisions', async () => {
    const db = openDb(':memory:');
    db.insertRecording({
      slug: 'always',
      r2Key: 'always.webm',
      mimeType: 'video/webm',
      createdAt: 1,
    });

    let calls = 0;
    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
      generateSlug: () => {
        calls++;
        return 'always';
      },
    });

    await expect(
      recordings.create({ contentType: 'video/webm', sizeBytes: 100 }),
    ).rejects.toThrow(/slug_generation_exhausted/);
    expect(calls).toBe(5);
    db.close();
  });
});
