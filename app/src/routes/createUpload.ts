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
