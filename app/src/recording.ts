import { randomBytes } from 'node:crypto';
import { eq, and, lt, desc } from 'drizzle-orm';
import type { Db } from './db/client';
import * as schema from './db/schema';

export type AllowedMime =
  | 'video/webm'
  | 'video/webm;codecs=vp9'
  | 'video/webm;codecs=vp9,opus'
  | 'video/webm;codecs=vp8,opus';

export const ALLOWED_MIME: readonly AllowedMime[] = Object.freeze([
  'video/webm',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
]);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 6;
const SLUG_RE = new RegExp(`^[A-Za-z0-9]{${SLUG_LENGTH}}$`);
const MAX_SLUG_TRIES = 5;

export class SlugGenerationExhaustedError extends Error {
  readonly tries: number;
  readonly lastError: unknown;
  constructor({ tries, lastError }: { tries: number; lastError: unknown }) {
    super(`slug_generation_exhausted after ${tries} tries (last: ${String(lastError)})`);
    this.name = 'SlugGenerationExhaustedError';
    this.tries = tries;
    this.lastError = lastError;
  }
}

export class UnsupportedContentTypeError extends Error {
  readonly contentType: string;
  constructor(contentType: string) {
    super(`Unsupported content type: "${contentType}"`);
    this.name = 'UnsupportedContentTypeError';
    this.contentType = contentType;
  }
}

/**
 * Thrown by `Recordings.create` when `mintUploadUrl` fails after the row has
 * been written. The row is **not** rolled back — the Recording is best-effort,
 * non-atomic by design (see ADR-0001, ADR-0002, ADR-0009). The orphaned slug
 * is recoverable from `.slug` for logging or a future v0.4 sweeper.
 */
export class UploadMintFailedError extends Error {
  readonly slug: string;
  readonly cause: unknown;
  constructor({ slug, cause }: { slug: string; cause: unknown }) {
    super(`upload_mint_failed for slug "${slug}" (cause: ${String(cause)})`);
    this.name = 'UploadMintFailedError';
    this.slug = slug;
    this.cause = cause;
  }
}

function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
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

function normalizeContentType(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/\s+/g, '');
}

export interface Recording {
  slug: string;
  userId: string;
  r2Key: string;
  mimeType: string;
  createdAt: Date;
}

export interface CreateRecordingArgs { contentType: string; sizeBytes: number; userId: string; }
export interface CreatedRecording    { slug: string; uploadUrl: string; viewerUrl: string; }
export interface ListRecordingsArgs  { userId: string; limit: number; before?: Date; }

export interface Recordings {
  /**
   * Creates a Recording: writes a row, mints an Upload URL, returns both URLs.
   *
   * @throws {UnsupportedContentTypeError} if `contentType` is not in `ALLOWED_MIME`.
   *   The row is never written.
   * @throws {SlugGenerationExhaustedError} after `MAX_SLUG_TRIES` consecutive
   *   slug collisions. The row is never written.
   * @throws {UploadMintFailedError} if `mintUploadUrl` rejects after the row
   *   has been written. The row is **not** rolled back — see ADR-0001/0002/0009.
   *   The orphaned slug is recoverable from the error.
   */
  create(args: CreateRecordingArgs): Promise<CreatedRecording>;
  get(slug: string): Promise<Recording | null>;
  listForUser(args: ListRecordingsArgs): Promise<Recording[]>;
  deleteForUser(args: { slug: string; userId: string }): Promise<Recording | null>;
  close(): void;
}

export interface RecordingsBaseDeps {
  /** Mints a presigned PUT URL the browser uses to upload bytes to R2. */
  mintUploadUrl: (args: {
    key: string;
    contentType: string;
    sizeBytes: number;
  }) => Promise<string>;
  /** Builds the absolute Viewer URL for a Recording. Owned by `urls.ts` — see docs/adr/0003. */
  viewerUrl: (slug: string) => string;
  /** Optional override for tests — defaults to the real CSPRNG-backed generator. */
  generateSlug?: () => string;
}

class DuplicateSlugError extends Error {
  constructor(slug: string) {
    super(`dup slug ${slug}`);
    this.name = 'DuplicateSlugError';
  }
}

async function createRecordingCore(args: {
  contentType: string;
  sizeBytes: number;
  userId: string;
  generateSlug: () => string;
  mintUploadUrl: RecordingsBaseDeps['mintUploadUrl'];
  viewerUrl: RecordingsBaseDeps['viewerUrl'];
  insert: (row: { slug: string; userId: string; r2Key: string; mimeType: string }) => Promise<void>;
}): Promise<CreatedRecording> {
  const normalizedContentType = normalizeContentType(args.contentType);
  if (!(ALLOWED_MIME as readonly string[]).includes(normalizedContentType)) {
    throw new UnsupportedContentTypeError(String(args.contentType));
  }
  let lastErr: unknown = null;
  for (let i = 0; i < MAX_SLUG_TRIES; i++) {
    const slug = args.generateSlug();
    const r2Key = r2KeyForSlug(slug);
    try {
      await args.insert({ slug, userId: args.userId, r2Key, mimeType: normalizedContentType });
    } catch (err) {
      if (err instanceof DuplicateSlugError) { lastErr = err; continue; }
      throw err;
    }
    let uploadUrl: string;
    try {
      uploadUrl = await args.mintUploadUrl({ key: r2Key, contentType: normalizedContentType, sizeBytes: args.sizeBytes });
    } catch (cause) {
      throw new UploadMintFailedError({ slug, cause });
    }
    return { slug, uploadUrl, viewerUrl: args.viewerUrl(slug) };
  }
  throw new SlugGenerationExhaustedError({ tries: MAX_SLUG_TRIES, lastError: lastErr });
}

// ---------- Postgres impl ----------

export function createPostgresRecordings(deps: RecordingsBaseDeps & { db: Db }): Recordings {
  const gen = deps.generateSlug ?? defaultGenerateSlug;
  return {
    async create(args) {
      return createRecordingCore({
        ...args,
        generateSlug: gen,
        mintUploadUrl: deps.mintUploadUrl,
        viewerUrl: deps.viewerUrl,
        insert: async (row) => {
          try {
            await deps.db.insert(schema.recordings).values(row);
          } catch (err: any) {
            if (err?.code === '23505') throw new DuplicateSlugError(row.slug);
            throw err;
          }
        },
      });
    },
    async get(slug) {
      if (!isValidSlug(slug)) return null;
      const [row] = await deps.db.select().from(schema.recordings).where(eq(schema.recordings.slug, slug));
      return row ?? null;
    },
    async listForUser({ userId, limit, before }) {
      const where = before
        ? and(eq(schema.recordings.userId, userId), lt(schema.recordings.createdAt, before))
        : eq(schema.recordings.userId, userId);
      return deps.db.select().from(schema.recordings).where(where)
        .orderBy(desc(schema.recordings.createdAt)).limit(limit);
    },
    async deleteForUser({ slug, userId }) {
      const [row] = await deps.db.delete(schema.recordings)
        .where(and(eq(schema.recordings.slug, slug), eq(schema.recordings.userId, userId)))
        .returning();
      return row ?? null;
    },
    close() {},
  };
}

// ---------- In-memory impl ----------

export function createInMemoryRecordings(deps: RecordingsBaseDeps): Recordings {
  const gen = deps.generateSlug ?? defaultGenerateSlug;
  const rows = new Map<string, Recording>();
  return {
    async create(args) {
      return createRecordingCore({
        ...args,
        generateSlug: gen,
        mintUploadUrl: deps.mintUploadUrl,
        viewerUrl: deps.viewerUrl,
        insert: async (row) => {
          if (rows.has(row.slug)) throw new DuplicateSlugError(row.slug);
          rows.set(row.slug, { ...row, createdAt: new Date() });
        },
      });
    },
    async get(slug) {
      if (!isValidSlug(slug)) return null;
      return rows.get(slug) ?? null;
    },
    async listForUser({ userId, limit, before }) {
      return [...rows.values()]
        .filter((r) => r.userId === userId && (!before || r.createdAt < before))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, limit);
    },
    async deleteForUser({ slug, userId }) {
      const row = rows.get(slug);
      if (!row || row.userId !== userId) return null;
      rows.delete(slug);
      return row;
    },
    close() {},
  };
}
