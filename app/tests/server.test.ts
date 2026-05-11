/**
 * Boot-time tests for the production wiring path.
 *
 * Every other server-side test boots through `tests/helpers/testApp.ts`, which
 * fakes R2 and uses `:memory:`. Those tests pin route behaviour but never
 * exercise the filesystem prep (`mkdirSync`), template loading (`readFileSync`),
 * or the production wiring shape itself. This file does — by calling
 * `bootServer` against a tmpdir with a real `viewer.html` on disk.
 *
 * The R2 SDK is constructed with fake credentials. That's fine: `createR2`
 * is local-only at construction time, and these tests never trigger
 * `mintUploadUrl`, so no network call is made.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bootServer } from '../src/server';
import type { AppConfig } from '../src/config';

const TEMPLATE = `<!doctype html>
<html><body><video src="{{PLAYBACK_URL}}"></video></body></html>`;

const LIBRARY_TEMPLATE = `<!doctype html>
<html><body><script id="library-data" type="application/json">{{RECORDINGS_JSON}}</script></body></html>`;

function buildConfig(dataDir: string): AppConfig {
  return {
    port: 3000,
    dataDir,
    maxUploadBytes: 500 * 1024 * 1024,
    publicAppUrl: 'https://record.example.com',
    databaseUrl: 'postgres://test',
    r2: {
      accessKeyId: 'fake-key',
      secretAccessKey: 'fake-secret',
      bucket: 'fake-bucket',
      endpoint: 'https://fake.r2.cloudflarestorage.com',
    },
    resend: {
      apiKey: 're_test',
      from: 'auth@example.com',
    },
    signinTokenTtlSeconds: 900,
    sessionTtlSeconds: 2592000,
    viewUrlTtlSeconds: 3600,
    cookieSecure: true,
  };
}

describe('bootServer', () => {
  let tmpRoot: string;
  let viewsDir: string;
  let dataDir: string;
  let cleanups: Array<() => void>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(os.tmpdir(), 'mool-boot-'));
    viewsDir = path.join(tmpRoot, 'views');
    dataDir = path.join(tmpRoot, 'data');
    mkdirSync(viewsDir, { recursive: true });
    writeFileSync(path.join(viewsDir, 'viewer.html'), TEMPLATE, 'utf8');
    writeFileSync(path.join(viewsDir, 'library.html'), LIBRARY_TEMPLATE, 'utf8');
    cleanups = [];
  });

  afterEach(() => {
    for (const fn of cleanups) fn();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('boots successfully and serves /healthz', async () => {
    const { app, recordings } = await bootServer({
      config: buildConfig(dataDir),
      viewsDir,
      publicDir: null,
      skipDb: true,
    });
    cleanups.push(() => recordings.close());

    const res = await request(app).get('/healthz');
    // skipDb=true → no dbHandle → dbHealth returns false → 503
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false });
  });

  it('creates the data directory if it does not exist', async () => {
    const nested = path.join(tmpRoot, 'does', 'not', 'exist', 'yet');
    expect(existsSync(nested)).toBe(false);

    const { recordings } = await bootServer({
      config: buildConfig(nested),
      viewsDir,
      publicDir: null,
      skipDb: true,
    });
    cleanups.push(() => recordings.close());

    expect(existsSync(nested)).toBe(true);
  });

  it('throws ENOENT when viewer.html is missing from viewsDir', async () => {
    const emptyViewsDir = path.join(tmpRoot, 'empty-views');
    mkdirSync(emptyViewsDir);

    await expect(
      bootServer({
        config: buildConfig(dataDir),
        viewsDir: emptyViewsDir,
        publicDir: null,
        skipDb: true,
      }),
    ).rejects.toThrow(/ENOENT.*viewer\.html/);
  });

  it('mounts the Viewer route through the real wiring (404 for unknown slug)', async () => {
    const { app, recordings } = await bootServer({
      config: buildConfig(dataDir),
      viewsDir,
      publicDir: null,
      skipDb: true,
    });
    cleanups.push(() => recordings.close());

    const res = await request(app).get('/v/abcdef');
    expect(res.status).toBe(404);
  });
});
