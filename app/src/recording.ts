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
        // orphaned by design (see docs/adr/0002): R2 is the
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
