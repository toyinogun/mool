import type { Request, Response } from 'express';
import { generateSlug } from '../slug';
import type { DB } from '../db';
import { DuplicateSlugError } from '../db';
import type { R2 } from '../r2';

const ALLOWED_MIME = new Set(['video/webm', 'video/webm;codecs=vp9']);
const MAX_SLUG_TRIES = 5;

export interface CreateUploadDeps {
  db: DB;
  r2: R2;
  maxUploadBytes: number;
  publicAppUrl: string;
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

    let slug = '';
    let r2Key = '';
    let inserted = false;
    for (let i = 0; i < MAX_SLUG_TRIES; i++) {
      slug = generateSlug();
      r2Key = `${slug}.webm`;
      try {
        // If mintUploadUrl rejects below, this row is orphaned (no R2 object
        // ever lands at this slug). Acceptable for v0.1 — the slug namespace is
        // ~57B, the viewer 404s, and R2 is the source of truth. Add a sweeper
        // when accounts/library land in v0.4.
        deps.db.insertRecording({
          slug,
          r2Key,
          mimeType: 'video/webm',
          createdAt: Date.now(),
        });
        inserted = true;
        break;
      } catch (err) {
        if (err instanceof DuplicateSlugError) continue;
        throw err;
      }
    }
    if (!inserted) {
      res.status(500).json({ error: 'slug_generation_exhausted' });
      return;
    }

    const uploadUrl = await deps.r2.mintUploadUrl({
      key: r2Key,
      contentType: 'video/webm',
      sizeBytes,
    });

    res.json({
      slug,
      uploadUrl,
      viewerUrl: `${deps.publicAppUrl.replace(/\/$/, '')}/v/${slug}`,
    });
  };
}
