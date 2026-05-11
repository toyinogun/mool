import { describe, it, expect } from 'vitest';
import {
  createInMemoryRecordings,
  SlugGenerationExhaustedError,
  UnsupportedContentTypeError,
  UploadMintFailedError,
} from '../src/recording';

function fakeR2() {
  return {
    async mintUploadUrl({ key }: { key: string; contentType: string; sizeBytes: number }) {
      return `https://fake-r2.test/${key}?signed=1`;
    },
  };
}

const PUBLIC_APP_URL = 'https://record.example.com';
const viewerUrlFor = (slug: string): string => `${PUBLIC_APP_URL}/v/${slug}`;
const TEST_USER_ID = 'test-user-id';

describe('createInMemoryRecordings.create', () => {
  it('returns slug, uploadUrl, and viewerUrl', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });

    const result = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 12_345,
      userId: TEST_USER_ID,
    });

    expect(result.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(result.uploadUrl).toBe(`https://fake-r2.test/${result.slug}.webm?signed=1`);
    expect(result.viewerUrl).toBe(`${PUBLIC_APP_URL}/v/${result.slug}`);
    recordings.close();
  });

  it("persists the recording with r2Key '<slug>.webm' so the route can compose its playback URL", async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });

    const { slug } = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 100,
      userId: TEST_USER_ID,
    });

    const recording = await recordings.get(slug);
    expect(recording).not.toBeNull();
    expect(recording!.slug).toBe(slug);
    expect(recording!.r2Key).toBe(`${slug}.webm`);
    recordings.close();
  });

  it('forwards the caller-provided contentType to R2', async () => {
    const seenContentTypes: string[] = [];
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      mintUploadUrl: async ({ key, contentType }) => {
        seenContentTypes.push(contentType);
        return `https://fake-r2.test/${key}?signed=1`;
      },
      viewerUrl: viewerUrlFor,
    });

    await recordings.create({
      contentType: 'video/webm;codecs=vp9',
      sizeBytes: 100,
      userId: TEST_USER_ID,
    });

    expect(seenContentTypes).toEqual(['video/webm;codecs=vp9']);
    recordings.close();
  });
});

describe('createInMemoryRecordings.create content-type validation', () => {
  it('rejects a contentType outside ALLOWED_MIME with UnsupportedContentTypeError', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });

    const err = await recordings
      .create({ contentType: 'video/mp4', sizeBytes: 1, userId: TEST_USER_ID })
      .then(
        () => {
          throw new Error('expected create to reject');
        },
        (e) => e,
      );
    expect(err).toBeInstanceOf(UnsupportedContentTypeError);
    expect((err as UnsupportedContentTypeError).contentType).toBe('video/mp4');

    // The row never lands — the seam rejects before insertion.
    expect(await recordings.get('______')).toBeNull();
    recordings.close();
  });

  it('accepts video/webm;codecs=vp9 (canonical AllowedMime literal)', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });
    const result = await recordings.create({
      contentType: 'video/webm;codecs=vp9',
      sizeBytes: 1,
      userId: TEST_USER_ID,
    });
    expect(result.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    recordings.close();
  });

  it('accepts video/webm;codecs=vp9,opus (v0.2 mic-enabled literal)', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });
    const result = await recordings.create({
      contentType: 'video/webm;codecs=vp9,opus',
      sizeBytes: 1,
      userId: TEST_USER_ID,
    });
    expect(result.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    recordings.close();
  });

  it('normalizes case and whitespace before validating', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });
    // Mixed case + a space inside the parameter — should normalize to
    // 'video/webm;codecs=vp9' and pass.
    const result = await recordings.create({
      contentType: 'Video/WebM; codecs=vp9',
      sizeBytes: 1,
      userId: TEST_USER_ID,
    });
    expect(result.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    recordings.close();
  });
});

describe('createInMemoryRecordings.get', () => {
  it('returns a Promise (locks in pre-v0.4 async shape for presigned-GET migration)', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });

    const result = recordings.get('zzzzzz');
    expect(result).toBeInstanceOf(Promise);
    expect(await result).toBeNull();
    recordings.close();
  });

  it('returns the stored Recording fields for a known slug', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
      generateSlug: () => 'abc123',
    });
    await recordings.create({
      contentType: 'video/webm;codecs=vp9',
      sizeBytes: 1,
      userId: TEST_USER_ID,
    });

    const got = await recordings.get('abc123');

    expect(got).not.toBeNull();
    expect(got!.slug).toBe('abc123');
    expect(got!.r2Key).toBe('abc123.webm');
    expect(got!.mimeType).toBe('video/webm;codecs=vp9');
    expect(got!.userId).toBe(TEST_USER_ID);
    expect(got!.createdAt).toBeInstanceOf(Date);
    recordings.close();
  });

  it('returns null for an unknown slug', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });

    expect(await recordings.get('zzzzzz')).toBeNull();
    recordings.close();
  });

  it('returns null for a malformed slug without touching db', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });

    expect(await recordings.get('!!')).toBeNull();
    expect(await recordings.get('toolong')).toBeNull();
    recordings.close();
  });
});

describe('slug generation (via create)', () => {
  it('produces highly unique slugs over many invocations', async () => {
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
    });

    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { slug } = await recordings.create({
        contentType: 'video/webm',
        sizeBytes: 1,
        userId: TEST_USER_ID,
      });
      expect(slug).toMatch(/^[A-Za-z0-9]{6}$/);
      seen.add(slug);
    }
    expect(seen.size).toBeGreaterThan(195);
    recordings.close();
  });
});

describe('createInMemoryRecordings.create slug collision retry', () => {
  it('retries when the generator returns a duplicate slug, then succeeds', async () => {
    const slugs = ['taken1', 'taken1', 'fresh2'];
    let i = 0;
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
      generateSlug: () => slugs[i++],
    });

    // First create claims 'taken1'.
    const first = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 1,
      userId: TEST_USER_ID,
    });
    expect(first.slug).toBe('taken1');

    // Second create gets 'taken1' (collision → retry), then 'fresh2'.
    const second = await recordings.create({
      contentType: 'video/webm',
      sizeBytes: 100,
      userId: TEST_USER_ID,
    });
    expect(second.slug).toBe('fresh2');
    expect(i).toBe(3);

    expect(await recordings.get('taken1')).not.toBeNull();
    expect(await recordings.get('fresh2')).not.toBeNull();
    recordings.close();
  });

  it('throws after exhausting MAX_SLUG_TRIES (5) collisions', async () => {
    let calls = 0;
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      viewerUrl: viewerUrlFor,
      generateSlug: () => {
        calls++;
        return 'always';
      },
    });

    // Pre-claim the slug, then attempt to create again with every retry colliding.
    await recordings.create({ contentType: 'video/webm', sizeBytes: 1, userId: TEST_USER_ID });
    expect(calls).toBe(1);
    calls = 0;

    const err = await recordings
      .create({ contentType: 'video/webm', sizeBytes: 100, userId: TEST_USER_ID })
      .then(
        () => {
          throw new Error('expected create to reject');
        },
        (e) => e,
      );
    expect(err).toBeInstanceOf(SlugGenerationExhaustedError);
    expect((err as SlugGenerationExhaustedError).tries).toBe(5);
    expect((err as SlugGenerationExhaustedError).lastError).toBeDefined();
    expect(calls).toBe(5);
    recordings.close();
  });
});

describe('createInMemoryRecordings.create orphan-row policy on R2 failure', () => {
  it('rejects with UploadMintFailedError (carrying the orphaned slug + cause) and leaves the row inserted', async () => {
    const r2Cause = new Error('R2 unavailable');
    const recordings = createInMemoryRecordings({
      ...fakeR2(),
      mintUploadUrl: async () => {
        throw r2Cause;
      },
      viewerUrl: viewerUrlFor,
      generateSlug: () => 'orph01',
    });

    const err = await recordings
      .create({ contentType: 'video/webm', sizeBytes: 100, userId: TEST_USER_ID })
      .then(
        () => {
          throw new Error('expected create to reject');
        },
        (e) => e,
      );
    expect(err).toBeInstanceOf(UploadMintFailedError);
    expect((err as UploadMintFailedError).slug).toBe('orph01');
    expect((err as UploadMintFailedError).cause).toBe(r2Cause);

    // Orphan-by-design: the row exists, the R2 object never lands.
    const recording = await recordings.get('orph01');
    expect(recording).not.toBeNull();
    expect(recording!.slug).toBe('orph01');
    expect(recording!.r2Key).toBe('orph01.webm');
    recordings.close();
  });
});
