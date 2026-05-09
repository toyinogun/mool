import type { Request, Response } from 'express';
import {
  UnsupportedContentTypeError,
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
      });
    } catch (err) {
      if (err instanceof UnsupportedContentTypeError) {
        const errBody: CreateUploadErrorResponse = { error: 'invalid_content_type' };
        res.status(400).json(errBody);
        return;
      }
      throw err;
    }
    res.json(toWire(created));
  };
}
