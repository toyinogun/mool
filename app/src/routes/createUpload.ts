import type { Request, Response } from 'express';
import { UnsupportedContentTypeError, type Recordings } from '../recording';
import type {
  CreateUploadResponse,
  CreateUploadErrorResponse,
} from '../contracts';

export interface CreateUploadDeps {
  recordings: Recordings;
  maxUploadBytes: number;
}

export function createUploadRoute(deps: CreateUploadDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const body = req.body ?? {};

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

    let created: CreateUploadResponse;
    try {
      created = await deps.recordings.create({
        contentType: body.contentType,
        sizeBytes,
      });
    } catch (err) {
      if (err instanceof UnsupportedContentTypeError) {
        const errBody: CreateUploadErrorResponse = { error: 'invalid_content_type' };
        res.status(400).json(errBody);
        return;
      }
      throw err;
    }
    res.json(created);
  };
}
