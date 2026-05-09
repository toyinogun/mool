/**
 * Wire contract for POST /create-upload.
 * Shared between the Express route, the Recording module, and the
 * frontend recorder.js (referenced via JSDoc @typedef).
 *
 * If you change a field name or an error code, update both ends — the
 * test in tests/contracts.test.ts pins the contract.
 */

export type AllowedMime = 'video/webm' | 'video/webm;codecs=vp9';

export const ALLOWED_MIME: readonly AllowedMime[] = Object.freeze([
  'video/webm',
  'video/webm;codecs=vp9',
]);

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
