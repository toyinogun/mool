import type { Request, Response } from 'express';
import { generateSlug } from '../slug';
import type { DB } from '../db';
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
      !Number.isFinite(sizeBytes) ||
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
        deps.db.insertRecording({
          slug,
          r2Key,
          mimeType: 'video/webm',
          createdAt: Date.now(),
        });
        inserted = true;
        break;
      } catch (err) {
        const code = (err as { code?: string }).code;
        if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY') continue;
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
