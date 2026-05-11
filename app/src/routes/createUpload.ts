import type { Request, Response } from 'express';
import {
  UnsupportedContentTypeError,
  UploadMintFailedError,
  type CreatedRecording,
  type Recordings,
} from '../recording';

export interface CreateUploadResponse {
  slug: string;
  uploadUrl: string;
  viewerUrl: string;
}

export type CreateUploadErrorCode =
  | 'invalid_content_type'
  | 'invalid_size_bytes'
  | 'file_too_large'
  | 'upload_mint_failed'
  | 'internal_server_error';

export interface CreateUploadErrorResponse {
  error: CreateUploadErrorCode;
  /** Present only on `file_too_large`. */
  maxBytes?: number;
}

export interface CreateUploadDeps {
  recordings: Recordings;
  maxUploadBytes: number;
}

function toWire(created: CreatedRecording): CreateUploadResponse {
  return {
    slug: created.slug,
    uploadUrl: created.uploadUrl,
    viewerUrl: created.viewerUrl,
  };
}

export function createUploadRoute(deps: CreateUploadDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    // requireSession middleware should have attached req.user
    const userId = req.user?.id;
    if (!userId) {
      // defensive guard — should be unreachable behind requireSession
      res.status(401).json({ error: 'unauthenticated' });
      return;
    }

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

    let created: CreatedRecording;
    try {
      created = await deps.recordings.create({
        contentType: body.contentType,
        sizeBytes,
        userId,
      });
    } catch (err) {
      if (err instanceof UnsupportedContentTypeError) {
        const errBody: CreateUploadErrorResponse = { error: 'invalid_content_type' };
        res.status(400).json(errBody);
        return;
      }
      if (err instanceof UploadMintFailedError) {
        // R2-side failure after the row was written. Distinct from internal
        // bugs (502 Bad Gateway, not 500): client may retry — a fresh slug
        // will be allocated. The orphaned row stays per ADR-0002/0009.
        const errBody: CreateUploadErrorResponse = { error: 'upload_mint_failed' };
        res.status(502).json(errBody);
        return;
      }
      throw err;
    }
    res.json(toWire(created));
  };
}
