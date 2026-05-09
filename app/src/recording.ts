import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
export type AllowedMime = 'video/webm' | 'video/webm;codecs=vp9';

export const ALLOWED_MIME: readonly AllowedMime[] = Object.freeze([
  'video/webm',
  'video/webm;codecs=vp9',
]);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const SLUG_LENGTH = 6;
const SLUG_RE = new RegExp(`^[A-Za-z0-9]{${SLUG_LENGTH}}$`);
const MAX_SLUG_TRIES = 5;

function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

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

class DuplicateSlugError extends Error {
  constructor(slug: string) {
    super(`Recording with slug "${slug}" already exists`);
    this.name = 'DuplicateSlugError';
  }
}

function normalizeContentType(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/\s+/g, '');
}

interface RecordingRow {
  slug: string;
  r2Key: string;
  mimeType: string;
  createdAt: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS recordings (
  slug        TEXT PRIMARY KEY,
  r2_key      TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recordings_created_at ON recordings(created_at);
`;

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
  playbackUrl: string;
}

export interface Recordings {
  create(args: CreateRecordingArgs): Promise<CreatedRecording>;
  get(slug: string): Promise<RecordingView | null>;
  close(): void;
}

export interface RecordingsDeps {
  /** Path to the SQLite file; use ':memory:' for tests. */
  dbPath: string;
  /** Mints a presigned PUT URL the browser uses to upload bytes to R2. */
  mintUploadUrl: (args: {
    key: string;
    contentType: string;
    sizeBytes: number;
  }) => Promise<string>;
  /** Builds the public URL where R2 serves a stored object's bytes. */
  publicUrl: (key: string) => string;
  /** Builds the absolute Viewer URL for a Recording. Owned by `urls.ts` — see docs/adr/0003. */
  viewerUrl: (slug: string) => string;
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
  if (deps.dbPath !== ':memory:') {
    mkdirSync(dirname(deps.dbPath), { recursive: true });
  }
  const db = new Database(deps.dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);

  const insertStmt = db.prepare(
    `INSERT INTO recordings (slug, r2_key, mime_type, created_at) VALUES (?, ?, ?, ?)`,
  );
  const getStmt = db.prepare(
    `SELECT slug, r2_key AS r2Key, mime_type AS mimeType, created_at AS createdAt
     FROM recordings WHERE slug = ?`,
  );

  function insertRow(row: RecordingRow): void {
    try {
      insertStmt.run(row.slug, row.r2Key, row.mimeType, row.createdAt);
    } catch (err) {
      if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        throw new DuplicateSlugError(row.slug);
      }
      throw err;
    }
  }

  function getRow(slug: string): RecordingRow | null {
    return (getStmt.get(slug) as RecordingRow | undefined) ?? null;
  }

  const generateSlug = deps.generateSlug ?? defaultGenerateSlug;

  return {
    async create({ contentType, sizeBytes }) {
      const normalizedContentType = normalizeContentType(contentType);
      if (!(ALLOWED_MIME as readonly string[]).includes(normalizedContentType)) {
        throw new UnsupportedContentTypeError(String(contentType));
      }
      let lastErr: unknown = null;
      for (let i = 0; i < MAX_SLUG_TRIES; i++) {
        const slug = generateSlug();
        const r2Key = r2KeyForSlug(slug);
        try {
          insertRow({
            slug,
            r2Key,
            mimeType: normalizedContentType,
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
        // orphaned by design (see docs/adr/0002): R2 is the source of truth,
        // the viewer 404s, and a sweeper can be added with accounts in v0.4.
        // We deliberately do NOT roll the row back.
        const uploadUrl = await deps.mintUploadUrl({
          key: r2Key,
          contentType: normalizedContentType,
          sizeBytes,
        });
        return {
          slug,
          uploadUrl,
          viewerUrl: deps.viewerUrl(slug),
        };
      }
      throw new SlugGenerationExhaustedError({
        tries: MAX_SLUG_TRIES,
        lastError: lastErr,
      });
    },

    async get(slug) {
      if (!isValidSlug(slug)) return null;
      const row = getRow(slug);
      if (!row) return null;
      return {
        slug: row.slug,
        playbackUrl: deps.publicUrl(row.r2Key),
      };
    },

    close() {
      db.close();
    },
  };
}
