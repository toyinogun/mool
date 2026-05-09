import type { Request, Response } from 'express';
import type { Recordings } from '../recording';
import {
  ALLOWED_MIME,
  type CreateUploadResponse,
  type CreateUploadErrorResponse,
} from '../contracts';

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
    if (!(ALLOWED_MIME as readonly string[]).includes(ct)) {
      const errBody: CreateUploadErrorResponse = { error: 'invalid_content_type' };
      res.status(400).json(errBody);
      return;
    }

    const sizeBytes = body.sizeBytes;
    if (
      typeof sizeBytes !== 'number' ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes <= 0
    ) {
      const errBody: CreateUploadErrorResponse = { error: 'invalid_size_bytes' };
      res.status(400).json(errBody);
      return;
    }
    if (sizeBytes > deps.maxUploadBytes) {
      const errBody: CreateUploadErrorResponse = {
        error: 'file_too_large',
        maxBytes: deps.maxUploadBytes,
      };
      res.status(413).json(errBody);
      return;
    }

    const created: CreateUploadResponse = await deps.recordings.create({
      contentType: ct,
      sizeBytes,
    });
    res.json(created);
  };
}
