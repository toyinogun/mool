/**
 * HTTP layer for the Recorder page's upload pipeline.
 *
 * Two pure async functions wrapping the two network calls the Recorder makes:
 *
 *   - `mintUpload` posts to /create-upload and produces a Recording (or a
 *     reason it couldn't).
 *   - `putBytes` PUTs the captured blob to the Upload URL.
 *
 * Both take `fetch` as a function dep and return a discriminated outcome
 * (`{ kind: 'ok', ... } | { kind: 'failed', reason }`). The Recorder-page
 * adapter (`recorder.js`) is the only thing that translates these outcomes
 * into state-machine events. This module knows nothing about the SM or
 * the DOM.
 *
 * Tested in `tests/recorderUpload.test.ts` against a fake fetch.
 *
 * @typedef {import('../routes/createUpload').CreateUploadResponse} CreateUploadResponse
 * @typedef {import('../routes/createUpload').CreateUploadErrorResponse} CreateUploadErrorResponse
 */

/**
 * @typedef {{ kind: 'ok', slug: string, uploadUrl: string, viewerUrl: string }} MintOk
 * @typedef {{ kind: 'failed', reason: string }} MintFailed
 * @typedef {MintOk | MintFailed} MintOutcome
 *
 * @typedef {{ kind: 'ok' }} PutOk
 * @typedef {{ kind: 'failed', reason: string }} PutFailed
 * @typedef {PutOk | PutFailed} PutOutcome
 */

/**
 * @param {{
 *   fetch: typeof globalThis.fetch,
 *   mimeType: string,
 *   sizeBytes: number,
 * }} args
 * @returns {Promise<MintOutcome>}
 */
export async function mintUpload({ fetch, mimeType, sizeBytes }) {
  let res;
  try {
    res = await fetch('/create-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: mimeType, sizeBytes }),
    });
  } catch {
    return { kind: 'failed', reason: 'could not reach server' };
  }
  let body;
  try {
    body = await res.json();
  } catch {
    return { kind: 'failed', reason: 'unreadable response' };
  }
  if (!res.ok) {
    /** @type {CreateUploadErrorResponse} */
    const errBody = body;
    return {
      kind: 'failed',
      reason: errBody?.error ?? String(res.status),
    };
  }
  /** @type {CreateUploadResponse} */
  const ok = body;
  return {
    kind: 'ok',
    slug: ok.slug,
    uploadUrl: ok.uploadUrl,
    viewerUrl: ok.viewerUrl,
  };
}

/**
 * @param {{
 *   fetch: typeof globalThis.fetch,
 *   uploadUrl: string,
 *   blob: Blob,
 *   mimeType: string,
 * }} args
 * @returns {Promise<PutOutcome>}
 */
export async function putBytes({ fetch, uploadUrl, blob, mimeType }) {
  let res;
  try {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
  } catch {
    return { kind: 'failed', reason: 'Upload failed during transfer.' };
  }
  if (!res.ok) {
    return {
      kind: 'failed',
      reason: `Upload to storage failed: HTTP ${res.status}`,
    };
  }
  return { kind: 'ok' };
}
