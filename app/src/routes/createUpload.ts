import type { Request, Response } from 'express';
import type { Recordings } from '../recording';
import type { CreateUploadResponse, CreateUploadErrorResponse } from '../contracts';

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
      const body: CreateUploadErrorResponse = { error: 'invalid_content_type' };
      res.status(400).json(body);
      return;
    }

    const sizeBytes = body.sizeBytes;
    if (
      typeof sizeBytes !== 'number' ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0
    ) {
      const body: CreateUploadErrorResponse = { error: 'invalid_size_bytes' };
      res.status(400).json(body);
      return;
    }
    if (sizeBytes > deps.maxUploadBytes) {
      const body: CreateUploadErrorResponse = {
        error: 'file_too_large',
        maxBytes: deps.maxUploadBytes,
      };
      res.status(413).json(body);
      return;
    }

    const created: CreateUploadResponse = await deps.recordings.create({
      contentType: 'video/webm',
      sizeBytes,
    });
    res.json(created);
  };
}
