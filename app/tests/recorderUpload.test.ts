import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — JSDoc-typed JS module shipped to the browser as well.
import { mintUpload, putBytes } from '../src/public/recorderUpload.js';

type FetchArgs = { url: string; init: RequestInit };

function captureFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const calls: FetchArgs[] = [];
  const fn = (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return impl(url, init);
  };
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function unreadableJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      throw new Error('parse fail');
    },
  } as unknown as Response;
}

function plainResponse(status: number): Response {
  return { ok: status >= 200 && status < 300, status } as unknown as Response;
}

describe('mintUpload — happy path', () => {
  it('returns ok with slug, uploadUrl, viewerUrl when server responds 200 with the body', async () => {
    const { fn } = captureFetch(async () =>
      jsonResponse(200, {
        slug: 'abc123',
        uploadUrl: 'https://r2.test/abc123.webm?sig=1',
        viewerUrl: 'https://record.test/v/abc123',
      }),
    );
    const r = await mintUpload({
      fetch: fn,
      mimeType: 'video/webm;codecs=vp9',
      sizeBytes: 1024,
    });
    expect(r).toEqual({
      kind: 'ok',
      slug: 'abc123',
      uploadUrl: 'https://r2.test/abc123.webm?sig=1',
      viewerUrl: 'https://record.test/v/abc123',
    });
  });

  it('POSTs JSON to /create-upload with { contentType, sizeBytes }', async () => {
    const { fn, calls } = captureFetch(async () =>
      jsonResponse(200, { slug: 'a', uploadUrl: 'b', viewerUrl: 'c' }),
    );
    await mintUpload({ fetch: fn, mimeType: 'video/webm', sizeBytes: 42 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/create-upload');
    expect(calls[0].init.method).toBe('POST');
    expect(
      (calls[0].init.headers as Record<string, string>)['Content-Type'],
    ).toBe('application/json');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      contentType: 'video/webm',
      sizeBytes: 42,
    });
  });
});

describe('mintUpload — failure modes', () => {
  it('returns failed/"could not reach server" when fetch throws', async () => {
    const fn = async () => {
      throw new Error('network down');
    };
    const r = await mintUpload({
      fetch: fn,
      mimeType: 'video/webm',
      sizeBytes: 1,
    });
    expect(r).toEqual({ kind: 'failed', reason: 'could not reach server' });
  });

  it('returns failed/"unreadable response" when JSON parsing fails', async () => {
    const { fn } = captureFetch(async () => unreadableJsonResponse(200));
    const r = await mintUpload({
      fetch: fn,
      mimeType: 'video/webm',
      sizeBytes: 1,
    });
    expect(r).toEqual({ kind: 'failed', reason: 'unreadable response' });
  });

  it('returns failed with the server-supplied error code on !ok', async () => {
    const { fn } = captureFetch(async () =>
      jsonResponse(400, { error: 'invalid_content_type' }),
    );
    const r = await mintUpload({
      fetch: fn,
      mimeType: 'video/mp4',
      sizeBytes: 1,
    });
    expect(r).toEqual({ kind: 'failed', reason: 'invalid_content_type' });
  });

  it('falls back to the status string when the !ok body has no error field', async () => {
    const { fn } = captureFetch(async () => jsonResponse(500, {}));
    const r = await mintUpload({
      fetch: fn,
      mimeType: 'video/webm',
      sizeBytes: 1,
    });
    expect(r).toEqual({ kind: 'failed', reason: '500' });
  });
});

describe('putBytes — happy path', () => {
  it('returns ok when the PUT succeeds', async () => {
    const { fn } = captureFetch(async () => plainResponse(200));
    const blob = new Blob([new Uint8Array(1024)], { type: 'video/webm' });
    const r = await putBytes({
      fetch: fn,
      uploadUrl: 'https://r2.test/abc.webm?sig=1',
      blob,
      mimeType: 'video/webm',
    });
    expect(r).toEqual({ kind: 'ok' });
  });

  it('PUTs the blob to the supplied URL with Content-Type set to mimeType', async () => {
    const { fn, calls } = captureFetch(async () => plainResponse(200));
    const blob = new Blob([new Uint8Array(64)], { type: 'video/webm;codecs=vp9' });
    await putBytes({
      fetch: fn,
      uploadUrl: 'https://r2.test/xyz.webm?sig=1',
      blob,
      mimeType: 'video/webm;codecs=vp9',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://r2.test/xyz.webm?sig=1');
    expect(calls[0].init.method).toBe('PUT');
    expect(
      (calls[0].init.headers as Record<string, string>)['Content-Type'],
    ).toBe('video/webm;codecs=vp9');
    expect(calls[0].init.body).toBe(blob);
  });
});

describe('putBytes — failure modes', () => {
  it('returns failed/"Upload failed during transfer." when fetch throws', async () => {
    const fn = async () => {
      throw new Error('socket reset');
    };
    const blob = new Blob([new Uint8Array(1)], { type: 'video/webm' });
    const r = await putBytes({
      fetch: fn,
      uploadUrl: 'https://r2.test/x.webm?sig=1',
      blob,
      mimeType: 'video/webm',
    });
    expect(r).toEqual({ kind: 'failed', reason: 'Upload failed during transfer.' });
  });

  it('returns failed with the HTTP status on !ok', async () => {
    const { fn } = captureFetch(async () => plainResponse(403));
    const blob = new Blob([new Uint8Array(1)], { type: 'video/webm' });
    const r = await putBytes({
      fetch: fn,
      uploadUrl: 'https://r2.test/x.webm?sig=1',
      blob,
      mimeType: 'video/webm',
    });
    expect(r).toEqual({
      kind: 'failed',
      reason: 'Upload to storage failed: HTTP 403',
    });
  });
});
