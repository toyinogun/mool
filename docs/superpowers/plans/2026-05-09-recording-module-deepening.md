# Recording Module Deepening — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull the scattered create-a-Recording / get-a-Recording logic out of the route handlers and behind a single deep `recording` module, so the contract ("best-effort, non-atomic creation, accept orphan rows") is named, tested, and the only place that knows about slugs, R2 keys, and viewer URLs.

**Architecture:** A new `app/src/recording.ts` module composes the existing `db` and `r2` adapters and absorbs the slug primitives. It exposes `create({ contentType, sizeBytes })` and `get(slug)` and owns: slug generation, slug validation, slug-collision retry, R2-key construction, presigned URL minting, viewer URL construction, and the documented orphan-row policy. Route handlers shrink to HTTP wiring + input validation. The `db` module gains a `DuplicateSlugError` so the recording module catches a domain error rather than a SQLite error code (preserves the v0.4 Postgres swap path). A shared `app/src/contracts.ts` pins the wire format between the route and `public/recorder.js`.

**Tech Stack:** TypeScript, Node.js, Express, `better-sqlite3`, `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, vitest, supertest. No new dependencies.

**Reference docs:**
- `/home/toyin/mool/CONTEXT.md` — domain language (Recording, Slug, R2 key, Upload URL, Viewer URL, Recorder/Viewer page)
- `/home/toyin/mool/docs/adr/0001-inject-db-and-r2-into-recording-module.md` — why deps are injected
- `/home/toyin/mool/docs/adr/0002-store-r2-key-instead-of-deriving-it.md` — why `r2_key` stays in the row
- `/home/toyin/mool/docs/superpowers/specs/2026-05-09-v0.1-anonymous-recorder-design.md` — original design (esp. §10 on the orphan-row policy)

---

## File Structure

**Created:**
- `app/src/recording.ts` — the Recording module: `createRecordings`, `Recordings`, `isValidSlug`, `SLUG_LENGTH`
- `app/src/contracts.ts` — wire types shared between route and frontend: `CreateUploadResponse`, `CreateUploadErrorCode`
- `app/tests/recording.test.ts` — unit tests for the Recording module (happy path, collision retry, orphan policy, get-by-slug, slug validity)
- `app/tests/contracts.test.ts` — pins the route's response shape and the full set of error codes against `contracts.ts`

**Modified:**
- `app/src/db.ts` — adds `DuplicateSlugError`; translates SQLite primary-key violations into it
- `app/src/app.ts` — `AppDeps` drops `db`, `r2`, `publicAppUrl`; gains `recordings`. Routes wired off `recordings`.
- `app/src/server.ts` — composition root builds `recordings = createRecordings({ db, r2, publicAppUrl })` and threads it
- `app/src/routes/createUpload.ts` — takes `{ recordings, maxUploadBytes }`; delegates orchestration to `recordings.create`
- `app/src/routes/viewer.ts` — takes `{ recordings, viewerTemplate }`; delegates to `recordings.get`; imports `isValidSlug` from recording module
- `app/src/public/recorder.js` — adds JSDoc `@typedef` import referencing `contracts.ts` for editor-time checking
- `app/tests/helpers/testApp.ts` — builds `recordings` over a real in-memory db + fake R2; exposes optional override for tests
- `app/tests/createUpload.test.ts` — adapts to new `AppDeps` shape; trims tests duplicated by `recording.test.ts`
- `app/tests/viewer.test.ts` — adapts to new `AppDeps` shape
- `app/tests/db.test.ts` — duplicate-slug test now asserts `DuplicateSlugError` instead of the SQLite code

**Deleted:**
- `app/src/slug.ts` — absorbed into `recording.ts`
- `app/tests/slug.test.ts` — assertions move into `recording.test.ts`

---

## Task 1: Translate SQLite primary-key violations into `DuplicateSlugError` in `db.ts`

**Why first:** This is small, mechanical, and unblocks Task 2 — the Recording module's collision-retry loop should catch `DuplicateSlugError`, not a SQLite error code.

**Files:**
- Modify: `app/src/db.ts`
- Modify: `app/src/routes/createUpload.ts:65-69` (interim — this code dies in Task 5, but it has to keep working until then)
- Test: `app/tests/db.test.ts:28-46`

- [ ] **Step 1: Update the existing duplicate-slug test to assert the new error type**

Edit `app/tests/db.test.ts`. Replace the third `it(...)` block (lines 28-46) with:

```typescript
  it('throws DuplicateSlugError on duplicate slug', () => {
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
    expect(caught).toBeInstanceOf(DuplicateSlugError);
    expect((caught as DuplicateSlugError).slug).toBe('dup001');
    db.close();
  });
```

Update the imports at the top of the file:

```typescript
import { describe, it, expect } from 'vitest';
import { openDb, DuplicateSlugError } from '../src/db';
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd /home/toyin/mool/app && npx vitest run tests/db.test.ts`

Expected: the new `'throws DuplicateSlugError on duplicate slug'` test fails — either with a TypeScript compile error (`DuplicateSlugError` is not exported from `'../src/db'`) or, if it compiles, with `caught` not being an instance of `DuplicateSlugError`.

- [ ] **Step 3: Add `DuplicateSlugError` and the translation in `db.ts`**

Edit `app/src/db.ts`. Add the error class after the imports and before `interface Recording`:

```typescript
export class DuplicateSlugError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`Recording with slug "${slug}" already exists`);
    this.name = 'DuplicateSlugError';
    this.slug = slug;
  }
}
```

Replace the `insertRecording` implementation in the returned object (line 45-47) with the translating version:

```typescript
    insertRecording(rec) {
      try {
        insertStmt.run(rec.slug, rec.r2Key, rec.mimeType, rec.createdAt);
      } catch (err) {
        if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
          throw new DuplicateSlugError(rec.slug);
        }
        throw err;
      }
    },
```

- [ ] **Step 4: Run the db tests and verify they pass**

Run: `cd /home/toyin/mool/app && npx vitest run tests/db.test.ts`

Expected: all three `openDb` tests pass.

- [ ] **Step 5: Update the route's collision-retry catch to use the new error**

`app/src/routes/createUpload.ts` currently catches the SQLite error code (lines 65-69). Until the route is replaced in Task 5, it has to keep working. Replace lines 65-69 with:

```typescript
      } catch (err) {
        if (err instanceof DuplicateSlugError) continue;
        throw err;
      }
```

Add the import at the top of the file (after the existing `import type { DB } from '../db';` line):

```typescript
import { DuplicateSlugError } from '../db';
```

- [ ] **Step 6: Run all tests and verify they still pass**

Run: `cd /home/toyin/mool/app && npx vitest run`

Expected: every test file passes — db, createUpload, viewer, slug, healthz, config.

- [ ] **Step 7: Commit**

```bash
cd /home/toyin/mool && git add app/src/db.ts app/src/routes/createUpload.ts app/tests/db.test.ts && git commit -m "refactor(db): translate primary-key violations into DuplicateSlugError

The DB module owns its own error vocabulary so callers don't pattern-match
on SQLite error codes. Preserves the v0.4 Postgres swap as a one-file change.

See docs/adr/0001 (injected deps) and the recording-module-deepening plan."
```

---

## Task 2: Build the Recording module — happy path, get-by-slug, slug primitives

**Why next:** The module exists in skeleton, with its happy path under test, before any caller switches over. Collision retry and orphan policy land in their own tasks so each behavior gets a dedicated test.

**Files:**
- Create: `app/src/recording.ts`
- Create: `app/tests/recording.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `app/tests/recording.test.ts` with the following content:

```typescript
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
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `cd /home/toyin/mool/app && npx vitest run tests/recording.test.ts`

Expected: all tests fail with `Failed to load url ../src/recording` (the module doesn't exist yet).

- [ ] **Step 3: Create the Recording module**

Create `app/src/recording.ts` with the following content:

```typescript
import { randomBytes } from 'node:crypto';
import { DuplicateSlugError, type DB, type Recording } from './db';
import type { R2 } from './r2';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const SLUG_LENGTH = 6;
const SLUG_RE = new RegExp(`^[A-Za-z0-9]{${SLUG_LENGTH}}$`);
const MAX_SLUG_TRIES = 5;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

export interface CreateRecordingArgs {
  contentType: string;
  sizeBytes: number;
}

export interface CreatedRecording {
  slug: string;
  uploadUrl: string;
  viewerUrl: string;
}

export interface RecordingView {
  slug: string;
  videoUrl: string;
  mimeType: string;
  createdAt: number;
}

export interface Recordings {
  create(args: CreateRecordingArgs): Promise<CreatedRecording>;
  get(slug: string): RecordingView | null;
}

export interface RecordingsDeps {
  db: DB;
  r2: R2;
  publicAppUrl: string;
  /** Optional override for tests — defaults to the real CSPRNG-backed generator. */
  generateSlug?: () => string;
}

function defaultGenerateSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let out = '';
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

function r2KeyForSlug(slug: string): string {
  return `${slug}.webm`;
}

export function createRecordings(deps: RecordingsDeps): Recordings {
  const generateSlug = deps.generateSlug ?? defaultGenerateSlug;
  const baseUrl = deps.publicAppUrl.replace(/\/+$/, '');

  return {
    async create({ contentType, sizeBytes }) {
      let lastErr: unknown = null;
      for (let i = 0; i < MAX_SLUG_TRIES; i++) {
        const slug = generateSlug();
        const r2Key = r2KeyForSlug(slug);
        try {
          deps.db.insertRecording({
            slug,
            r2Key,
            mimeType: 'video/webm',
            createdAt: Date.now(),
          });
        } catch (err) {
          if (err instanceof DuplicateSlugError) {
            lastErr = err;
            continue;
          }
          throw err;
        }
        // Row inserted. Mint the upload URL. If R2 fails here the row is
        // orphaned by design (see docs/adr/0002 and spec §10): R2 is the
        // source of truth, the viewer 404s, and a sweeper can be added with
        // accounts in v0.4. We deliberately do NOT roll the row back.
        const uploadUrl = await deps.r2.mintUploadUrl({
          key: r2Key,
          contentType,
          sizeBytes,
        });
        return {
          slug,
          uploadUrl,
          viewerUrl: `${baseUrl}/v/${slug}`,
        };
      }
      throw new Error(
        `slug_generation_exhausted after ${MAX_SLUG_TRIES} tries (last: ${String(lastErr)})`,
      );
    },

    get(slug) {
      if (!isValidSlug(slug)) return null;
      const row: Recording | null = deps.db.getRecording(slug);
      if (!row) return null;
      return {
        slug: row.slug,
        videoUrl: deps.r2.publicUrl(row.r2Key),
        mimeType: row.mimeType,
        createdAt: row.createdAt,
      };
    },
  };
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `cd /home/toyin/mool/app && npx vitest run tests/recording.test.ts`

Expected: every test in `recording.test.ts` passes. The `slug generation` test is probabilistic but with a 200-sample threshold of 195 it should pass with overwhelming probability against a 57-billion-slot namespace.

- [ ] **Step 5: Run the full test suite to confirm nothing regressed**

Run: `cd /home/toyin/mool/app && npx vitest run`

Expected: every existing test still passes. The Recording module is wired in but not yet used by the routes.

- [ ] **Step 6: Commit**

```bash
cd /home/toyin/mool && git add app/src/recording.ts app/tests/recording.test.ts && git commit -m "feat(recording): add Recording module with create/get + slug primitives

The module composes db and r2, absorbs slug generation and validation,
and owns r2_key construction and viewer URL templating. Routes will move
onto it in a follow-up task. Slug uniqueness covered probabilistically via
the create path; collision retry and orphan-row policy land in their own
tasks with deterministic fakes."
```

---

## Task 3: Test the slug-collision retry loop deterministically

**Why this needs its own task:** The probabilistic test in Task 2 cannot exercise the retry path — collisions over 200 samples in a 57-billion-slot namespace effectively never happen. Inject a stub generator and pin the behavior.

**Files:**
- Modify: `app/tests/recording.test.ts` (add a new `describe`)

- [ ] **Step 1: Write the failing tests**

Append the following to `app/tests/recording.test.ts`:

```typescript
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
    db.close();
  });

  it('throws after exhausting MAX_SLUG_TRIES collisions', async () => {
    const db = openDb(':memory:');
    db.insertRecording({
      slug: 'always',
      r2Key: 'always.webm',
      mimeType: 'video/webm',
      createdAt: 1,
    });

    const recordings = createRecordings({
      db,
      r2: fakeR2(),
      publicAppUrl: PUBLIC_APP_URL,
      generateSlug: () => 'always',
    });

    await expect(
      recordings.create({ contentType: 'video/webm', sizeBytes: 100 }),
    ).rejects.toThrow(/slug_generation_exhausted/);
    db.close();
  });
});
```

- [ ] **Step 2: Run the tests and verify they pass**

The retry behavior was already implemented in Task 2's module body — these tests pin it.

Run: `cd /home/toyin/mool/app && npx vitest run tests/recording.test.ts`

Expected: both new tests pass alongside the existing ones. If they fail, the retry implementation in `recording.ts` does not match the contract — fix the module, not the tests.

- [ ] **Step 3: Commit**

```bash
cd /home/toyin/mool && git add app/tests/recording.test.ts && git commit -m "test(recording): pin slug collision retry with deterministic generator"
```

---

## Task 4: Test the orphan-row policy on R2 failure

**Why this needs its own task:** This is the failure mode the spec explicitly accepts (§10) but never tested. With the recording module's injectable deps, it becomes a one-test exercise.

**Files:**
- Modify: `app/tests/recording.test.ts` (add a new `describe`)

- [ ] **Step 1: Write the failing tests**

Append the following to `app/tests/recording.test.ts`:

```typescript
describe('createRecordings.create orphan-row policy on R2 failure', () => {
  it('propagates the R2 error and leaves the row inserted (orphaned by design)', async () => {
    const db = openDb(':memory:');
    const failingR2: R2 = {
      async mintUploadUrl() {
        throw new Error('R2 unavailable');
      },
      publicUrl(key) {
        return `https://videos.example.com/${key}`;
      },
    };
    const recordings = createRecordings({
      db,
      r2: failingR2,
      publicAppUrl: PUBLIC_APP_URL,
      generateSlug: () => 'orph01',
    });

    await expect(
      recordings.create({ contentType: 'video/webm', sizeBytes: 100 }),
    ).rejects.toThrow(/R2 unavailable/);

    // Orphan-by-design: the row exists, the R2 object never lands.
    // See docs/adr/0002 and spec §10. A future sweeper (v0.4) reconciles.
    const orphan = db.getRecording('orph01');
    expect(orphan).not.toBeNull();
    expect(orphan!.r2Key).toBe('orph01.webm');
    db.close();
  });
});
```

- [ ] **Step 2: Run the tests and verify they pass**

Run: `cd /home/toyin/mool/app && npx vitest run tests/recording.test.ts`

Expected: the new test passes. The orphan behavior was already coded into the module in Task 2 — this test makes the documented policy verifiable.

- [ ] **Step 3: Commit**

```bash
cd /home/toyin/mool && git add app/tests/recording.test.ts && git commit -m "test(recording): pin orphan-row policy on R2 failure

The v0.1 spec accepts that an R2 failure after the SQLite insert leaves
an orphan row. This test makes that contract observable so a future
implementer can't silently change it."
```

---

## Task 5: Wire the Recording module into the routes; remove `slug.ts`

**Why this is one task:** The route changes, the `AppDeps` change, the `server.ts` wiring, the test-helper update, and the deletion of `slug.ts` are all coupled — the build won't pass until they're done together. Each step inside is small.

**Files:**
- Modify: `app/src/app.ts`
- Modify: `app/src/server.ts`
- Modify: `app/src/routes/createUpload.ts`
- Modify: `app/src/routes/viewer.ts`
- Modify: `app/tests/helpers/testApp.ts`
- Modify: `app/tests/createUpload.test.ts`
- Modify: `app/tests/viewer.test.ts`
- Delete: `app/src/slug.ts`
- Delete: `app/tests/slug.test.ts`

- [ ] **Step 1: Replace `createUpload.ts` with the recordings-driven version**

Overwrite `app/src/routes/createUpload.ts` with:

```typescript
import type { Request, Response } from 'express';
import type { Recordings } from '../recording';

const ALLOWED_MIME = new Set(['video/webm', 'video/webm;codecs=vp9']);

export interface CreateUploadDeps {
  recordings: Recordings;
  maxUploadBytes: number;
}

function normalizeMime(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/\s+/g, '');
}

export function createUploadRoute(deps: CreateUploadDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = req.body ?? {};
    const ct = normalizeMime(body.contentType);
    if (!ALLOWED_MIME.has(ct)) {
      res.status(400).json({ error: 'invalid_content_type' });
      return;
    }

    const sizeBytes = body.sizeBytes;
    if (
      typeof sizeBytes !== 'number' ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0
    ) {
      res.status(400).json({ error: 'invalid_size_bytes' });
      return;
    }
    if (sizeBytes > deps.maxUploadBytes) {
      res
        .status(413)
        .json({ error: 'file_too_large', maxBytes: deps.maxUploadBytes });
      return;
    }

    const created = await deps.recordings.create({ contentType: 'video/webm', sizeBytes });
    res.json(created);
  };
}
```

- [ ] **Step 2: Replace `viewer.ts` with the recordings-driven version**

Overwrite `app/src/routes/viewer.ts` with:

```typescript
import type { Request, Response } from 'express';
import type { Recordings } from '../recording';

export interface ViewerDeps {
  recordings: Recordings;
  viewerTemplate: string;
}

export function viewerRoute(deps: ViewerDeps) {
  return (req: Request, res: Response): void => {
    const { slug } = req.params;
    const view = deps.recordings.get(slug);
    if (!view) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    // Replacer function avoids $-interpretation in the replacement string,
    // so URLs containing $ characters substitute literally.
    const html = deps.viewerTemplate.replace(/\{\{VIDEO_URL\}\}/g, () => view.videoUrl);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  };
}
```

- [ ] **Step 3: Update `app.ts` to expose `recordings` instead of `db` + `r2` + `publicAppUrl`**

Overwrite `app/src/app.ts` with:

```typescript
import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import type { Recordings } from './recording';
import { createUploadRoute } from './routes/createUpload';
import { viewerRoute } from './routes/viewer';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async route handler so rejected promises flow into Express's
 * error-handling middleware. Express 4 only catches synchronous throws.
 */
export function asyncRoute(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export interface AppDeps {
  recordings: Recordings;
  maxUploadBytes: number;
  viewerTemplate: string;
  /** Absolute path to the static-assets directory, or null in tests. */
  publicDir: string | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '4kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/v/:slug', viewerRoute({
    recordings: deps.recordings,
    viewerTemplate: deps.viewerTemplate,
  }));
  app.post('/create-upload', asyncRoute(createUploadRoute({
    recordings: deps.recordings,
    maxUploadBytes: deps.maxUploadBytes,
  })));

  if (deps.publicDir) {
    app.use(express.static(deps.publicDir));
  }

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      if (res.headersSent) return;
      res.status(500).json({ error: 'internal_server_error' });
    },
  );

  return app;
}
```

- [ ] **Step 4: Update `server.ts` to build `recordings` and pass it through**

Overwrite `app/src/server.ts` with:

```typescript
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config';
import { openDb } from './db';
import { createR2 } from './r2';
import { createRecordings } from './recording';
import { createApp } from './app';

const config = loadConfig();
const db = openDb(path.join(config.dataDir, 'db.sqlite'));
const r2 = createR2(config.r2);
const recordings = createRecordings({
  db,
  r2,
  publicAppUrl: config.publicAppUrl,
});
const viewerTemplate = readFileSync(
  path.join(__dirname, 'views', 'viewer.html'),
  'utf8',
);
const publicDir = path.join(__dirname, 'public');

const app = createApp({
  recordings,
  maxUploadBytes: config.maxUploadBytes,
  viewerTemplate,
  publicDir,
});

app.listen(config.port, () => {
  console.log(`Mool listening on :${config.port}`);
});
```

- [ ] **Step 5: Update `tests/helpers/testApp.ts` to build `recordings` for the integration tests**

Overwrite `app/tests/helpers/testApp.ts` with:

```typescript
import { createApp } from '../../src/app';
import { openDb, type DB } from '../../src/db';
import { createRecordings, type Recordings } from '../../src/recording';
import type { R2 } from '../../src/r2';
import type { Express } from 'express';

export function fakeR2(): R2 {
  return {
    async mintUploadUrl({ key }) {
      return `https://fake-r2.test/${key}?signed=1`;
    },
    publicUrl(key) {
      return `https://videos.example.com/${key}`;
    },
  };
}

const VIEWER_TEMPLATE_STUB = `<!doctype html>
<html><body><video src="{{VIDEO_URL}}"></video></body></html>`;

export interface BuildTestAppOpts {
  maxUploadBytes?: number;
  /** Override the recordings module entirely (e.g. to inject a failing R2). */
  recordings?: Recordings;
  /** Override the R2 adapter used to construct the default recordings module. */
  r2?: R2;
}

export function buildTestApp(opts: BuildTestAppOpts = {}): {
  app: Express;
  db: DB;
  recordings: Recordings;
  cleanup: () => void;
} {
  const db = openDb(':memory:');
  const recordings =
    opts.recordings ??
    createRecordings({
      db,
      r2: opts.r2 ?? fakeR2(),
      publicAppUrl: 'https://record.example.com',
    });
  const app = createApp({
    recordings,
    maxUploadBytes: opts.maxUploadBytes ?? 500 * 1024 * 1024,
    viewerTemplate: VIEWER_TEMPLATE_STUB,
    publicDir: null,
  });
  return { app, db, recordings, cleanup: () => db.close() };
}
```

- [ ] **Step 6: Update `tests/createUpload.test.ts` for the new `AppDeps` shape**

The existing happy-path, validation, and 413 tests still apply — they exercise the route's HTTP wiring, not the recording-creation logic. The "R2 minting fails" test at lines 123-149 needs to construct the failing R2 via the new helper. Replace the entire file content with:

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { R2 } from '../src/r2';
import { buildTestApp, fakeR2 } from './helpers/testApp';

describe('POST /create-upload', () => {
  it('returns slug, uploadUrl, and viewerUrl on success', async () => {
    const { app, db, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 12_345 });

      expect(res.status).toBe(200);
      expect(res.body.slug).toMatch(/^[A-Za-z0-9]{6}$/);
      expect(res.body.uploadUrl).toContain(`${res.body.slug}.webm`);
      expect(res.body.viewerUrl).toBe(
        `https://record.example.com/v/${res.body.slug}`,
      );
      expect(db.getRecording(res.body.slug)).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('rejects unknown content types with 400', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/mp4', sizeBytes: 100 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_content_type');
    } finally {
      cleanup();
    }
  });

  it('accepts video/webm with codec parameter (e.g. video/webm;codecs=vp9)', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm;codecs=vp9', sizeBytes: 100 });
      expect(res.status).toBe(200);
    } finally {
      cleanup();
    }
  });

  it('rejects missing sizeBytes with 400', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects sizeBytes <= 0 with 400', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 0 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects non-integer sizeBytes with 400', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 1.5 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('invalid_size_bytes');
    } finally {
      cleanup();
    }
  });

  it('rejects sizeBytes over the cap with 413', async () => {
    const { app, cleanup } = buildTestApp({ maxUploadBytes: 1024 });
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 2048 });
      expect(res.status).toBe(413);
      expect(res.body.error).toBe('file_too_large');
      expect(res.body.maxBytes).toBe(1024);
    } finally {
      cleanup();
    }
  });

  it('returns 500 (not hang) when the recordings module rejects', async () => {
    const failingR2: R2 = {
      ...fakeR2(),
      async mintUploadUrl() {
        throw new Error('R2 unavailable');
      },
    };
    const { app, cleanup } = buildTestApp({ r2: failingR2 });
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 100 });
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('internal_server_error');
    } finally {
      cleanup();
    }
  });
});
```

(The "persists the recording with the expected r2Key" assertion is now covered by `recording.test.ts` and dropped here.)

- [ ] **Step 7: Confirm `tests/viewer.test.ts` still passes unchanged**

The viewer test file does not reference `db`, `r2`, or `publicAppUrl` directly — it inserts via `db.insertRecording` (still exposed) and reads `https://videos.example.com/...` (the fake R2's `publicUrl`). It needs no changes; verify by reading.

Read `app/tests/viewer.test.ts` — confirm no `r2:` or `publicAppUrl:` literal references. If clean, no edit. (Expected: no edits required.)

- [ ] **Step 8: Delete `slug.ts` and `slug.test.ts`**

Their content is fully absorbed into `recording.ts` and `recording.test.ts`.

```bash
cd /home/toyin/mool && rm app/src/slug.ts app/tests/slug.test.ts
```

- [ ] **Step 9: Run the full test suite and the TypeScript compile**

Run: `cd /home/toyin/mool/app && npx tsc --noEmit && npx vitest run`

Expected: TypeScript compiles cleanly (no orphan references to `slug.ts`, no `db`/`r2`/`publicAppUrl` in `AppDeps`). All tests in `db.test.ts`, `recording.test.ts`, `createUpload.test.ts`, `viewer.test.ts`, `healthz.test.ts`, `config.test.ts` pass.

If TypeScript flags references to the deleted module, find and remove the import; the route handlers and `app.ts` should be the only callers and they were updated above.

- [ ] **Step 10: Commit**

```bash
cd /home/toyin/mool && git add -A app/src/app.ts app/src/server.ts app/src/routes/createUpload.ts app/src/routes/viewer.ts app/src/slug.ts app/tests/helpers/testApp.ts app/tests/createUpload.test.ts app/tests/slug.test.ts && git commit -m "refactor(routes): wire createUpload and viewer through the Recording module

Routes shrink to HTTP wiring + input validation. The Recording module
owns slug generation, slug validation, r2_key construction, presigned URL
minting, viewer URL templating, and the orphan-row policy. AppDeps drops
db, r2, publicAppUrl in favour of recordings. slug.ts and slug.test.ts
are absorbed."
```

---

## Task 6: Add wire contract types in `contracts.ts` and a JSDoc reference in `recorder.js`

**Why:** The route response and the frontend consumer share an implicit contract today. A shared type catches drift in the editor.

**Files:**
- Create: `app/src/contracts.ts`
- Modify: `app/src/routes/createUpload.ts`
- Modify: `app/src/recording.ts` (re-export the response type for cohesion)
- Modify: `app/src/public/recorder.js`

- [ ] **Step 1: Create `contracts.ts`**

Create `app/src/contracts.ts` with:

```typescript
/**
 * Wire contract for POST /create-upload.
 * Shared between the Express route, the Recording module, and the
 * frontend recorder.js (referenced via JSDoc @typedef).
 *
 * If you change a field name or an error code, update both ends — the
 * test in tests/contracts.test.ts pins the contract.
 */

export interface CreateUploadResponse {
  slug: string;
  uploadUrl: string;
  viewerUrl: string;
}

export type CreateUploadErrorCode =
  | 'invalid_content_type'
  | 'invalid_size_bytes'
  | 'file_too_large'
  | 'internal_server_error';

export interface CreateUploadErrorResponse {
  error: CreateUploadErrorCode;
  /** Present only on `file_too_large`. */
  maxBytes?: number;
}
```

- [ ] **Step 2: Type the route's response**

Edit `app/src/routes/createUpload.ts`. Add the import at the top:

```typescript
import type { CreateUploadResponse, CreateUploadErrorResponse } from '../contracts';
```

Replace the success return at the end of the handler:

```typescript
    const created: CreateUploadResponse = await deps.recordings.create({
      contentType: 'video/webm',
      sizeBytes,
    });
    res.json(created);
```

Replace each `res.status(...).json({ error: ... })` call with a typed object. The `invalid_content_type`, `invalid_size_bytes`, and `file_too_large` branches each become:

```typescript
    if (!ALLOWED_MIME.has(ct)) {
      const body: CreateUploadErrorResponse = { error: 'invalid_content_type' };
      res.status(400).json(body);
      return;
    }
```

```typescript
    if (
      typeof sizeBytes !== 'number' ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0
    ) {
      const body: CreateUploadErrorResponse = { error: 'invalid_size_bytes' };
      res.status(400).json(body);
      return;
    }
```

```typescript
    if (sizeBytes > deps.maxUploadBytes) {
      const body: CreateUploadErrorResponse = {
        error: 'file_too_large',
        maxBytes: deps.maxUploadBytes,
      };
      res.status(413).json(body);
      return;
    }
```

The `internal_server_error` branch in `app.ts`'s error middleware also needs the type:

Edit `app/src/app.ts`. Add the import:

```typescript
import type { CreateUploadErrorResponse } from './contracts';
```

Replace the error middleware body:

```typescript
  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      if (res.headersSent) return;
      const body: CreateUploadErrorResponse = { error: 'internal_server_error' };
      res.status(500).json(body);
    },
  );
```

- [ ] **Step 3: Reconcile the `Recordings.create` return type with `CreateUploadResponse`**

In `app/src/recording.ts`, change the `CreatedRecording` interface so it is exactly `CreateUploadResponse` — this keeps the recording module honest about the wire contract it satisfies. Replace:

```typescript
export interface CreatedRecording {
  slug: string;
  uploadUrl: string;
  viewerUrl: string;
}
```

with:

```typescript
import type { CreateUploadResponse } from './contracts';
export type CreatedRecording = CreateUploadResponse;
```

The `import type` line goes with the other imports at the top of the file; remove the inline interface body. The signatures and field names are unchanged so callers continue to compile.

- [ ] **Step 4: Add the JSDoc typedef import in `recorder.js`**

Edit `app/src/public/recorder.js`. At the top of the file (above the existing `const startBtn = ...` line), add:

```javascript
/**
 * @typedef {import('../contracts').CreateUploadResponse} CreateUploadResponse
 * @typedef {import('../contracts').CreateUploadErrorResponse} CreateUploadErrorResponse
 */
```

Find the destructuring at the existing `const { uploadUrl, viewerUrl } = createBody;` line and replace with an annotated form so editors check field access:

```javascript
  /** @type {CreateUploadResponse} */
  const ok = createBody;
  const { uploadUrl, viewerUrl } = ok;
```

Find the error display line and annotate:

```javascript
  if (!createRes.ok) {
    /** @type {CreateUploadErrorResponse} */
    const errBody = createBody;
    setStatus(`Upload rejected: ${errBody.error ?? createRes.status}`);
    resetUiAfterFailure();
    return;
  }
```

Note: `recorder.js` is served as a static asset; the browser does not resolve the typedef path at runtime. The `import('../contracts')` is read by TypeScript-aware editors only.

- [ ] **Step 5: Run TypeScript and the full test suite**

Run: `cd /home/toyin/mool/app && npx tsc --noEmit && npx vitest run`

Expected: TypeScript compiles. Tests pass — no behavior changed, only types.

- [ ] **Step 6: Commit**

```bash
cd /home/toyin/mool && git add app/src/contracts.ts app/src/routes/createUpload.ts app/src/app.ts app/src/recording.ts app/src/public/recorder.js && git commit -m "feat(contracts): pin /create-upload wire format in shared types

CreateUploadResponse and CreateUploadErrorCode live in contracts.ts and
are referenced by the route, the Recording module, and recorder.js (via
JSDoc typedef). Field-name or error-code drift now surfaces in the
editor for both ends."
```

---

## Task 7: Add the contract test pinning the response shape and the full set of error codes

**Why:** Editor-time checking catches drift in code that imports `contracts.ts`. A test catches drift introduced by code that *should* import it but doesn't — and proves every declared error code is reachable.

**Files:**
- Create: `app/tests/contracts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/tests/contracts.test.ts` with:

```typescript
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import type { R2 } from '../src/r2';
import type {
  CreateUploadResponse,
  CreateUploadErrorCode,
} from '../src/contracts';
import { buildTestApp, fakeR2 } from './helpers/testApp';

describe('POST /create-upload wire contract', () => {
  it('success response contains exactly { slug, uploadUrl, viewerUrl }', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app)
        .post('/create-upload')
        .send({ contentType: 'video/webm', sizeBytes: 100 });

      expect(res.status).toBe(200);
      const body = res.body as CreateUploadResponse;
      expect(Object.keys(body).sort()).toEqual(
        ['slug', 'uploadUrl', 'viewerUrl'].sort(),
      );
      expect(typeof body.slug).toBe('string');
      expect(typeof body.uploadUrl).toBe('string');
      expect(typeof body.viewerUrl).toBe('string');
    } finally {
      cleanup();
    }
  });

  it('emits every declared CreateUploadErrorCode under the documented condition', async () => {
    // This test is the canonical reachability proof for the union type.
    // If you add a new code to CreateUploadErrorCode, add a case here.
    const declared: CreateUploadErrorCode[] = [
      'invalid_content_type',
      'invalid_size_bytes',
      'file_too_large',
      'internal_server_error',
    ];
    const observed = new Set<string>();

    // invalid_content_type
    {
      const { app, cleanup } = buildTestApp();
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/mp4', sizeBytes: 100 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // invalid_size_bytes
    {
      const { app, cleanup } = buildTestApp();
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/webm' });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // file_too_large
    {
      const { app, cleanup } = buildTestApp({ maxUploadBytes: 1 });
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/webm', sizeBytes: 1024 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    // internal_server_error (via failing R2)
    {
      const failingR2: R2 = {
        ...fakeR2(),
        async mintUploadUrl() {
          throw new Error('R2 unavailable');
        },
      };
      const { app, cleanup } = buildTestApp({ r2: failingR2 });
      try {
        const res = await request(app)
          .post('/create-upload')
          .send({ contentType: 'video/webm', sizeBytes: 100 });
        observed.add(res.body.error);
      } finally {
        cleanup();
      }
    }

    expect([...observed].sort()).toEqual([...declared].sort());
  });
});
```

- [ ] **Step 2: Run the test and verify it passes**

Run: `cd /home/toyin/mool/app && npx vitest run tests/contracts.test.ts`

Expected: both tests pass. The first asserts the success-response shape is exactly the declared keys. The second asserts the set of emitted error codes equals the declared union — if a future change adds an error code without exercising it (or exercises one that isn't declared), the assertion fails.

- [ ] **Step 3: Run the full suite one more time**

Run: `cd /home/toyin/mool/app && npx tsc --noEmit && npx vitest run`

Expected: every test file passes; TypeScript compiles cleanly.

- [ ] **Step 4: Commit**

```bash
cd /home/toyin/mool && git add app/tests/contracts.test.ts && git commit -m "test(contracts): pin response shape and prove every error code is reachable"
```

---

## Self-Review

**Spec coverage:** Each of the five candidates from the architecture-improvement grilling is covered:
- #1 Recording module — Tasks 2, 3, 4, 5
- #2 r2_key ownership — Task 5 (key construction lives only in `recording.ts`); column kept per ADR-0002
- #3 SQLite-specific error code — Task 1
- #4 slug duplication — Task 2 (via `isValidSlug` exported from recording module) + Task 5 (viewer route consumes it via `recordings.get`)
- #5 wire contract — Tasks 6 and 7

**Type consistency:** `Recordings`, `CreateRecordingArgs`, `CreatedRecording`, `RecordingView`, `RecordingsDeps` are introduced in Task 2 and used unchanged in Tasks 5 and 6. `CreatedRecording` is reconciled to `CreateUploadResponse` in Task 6 with no field renames. `DuplicateSlugError` is introduced in Task 1 and consumed in Task 2.

**Placeholder scan:** Every step contains the actual code or command. No "TODO", "TBD", "fill in", or "similar to". File paths are absolute or rooted at the repo. Test expectations include the exact assertion lines.

**Frequent commits:** Each task ends in a commit. Tasks 3 and 4 are small (one test addition each) but get their own commits because they pin distinct named behaviors (collision retry, orphan policy) that future readers should be able to find with `git log`.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-09-recording-module-deepening.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
