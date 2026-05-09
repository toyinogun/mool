import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config';

const validEnv = {
  PUBLIC_APP_URL: 'https://record.example.com',
  R2_ACCESS_KEY_ID: 'k',
  R2_SECRET_ACCESS_KEY: 's',
  R2_BUCKET: 'mool-recordings',
  R2_ENDPOINT: 'https://abc.r2.cloudflarestorage.com',
  R2_PUBLIC_BASE_URL: 'https://videos.example.com',
};

describe('loadConfig', () => {
  it('loads when all required vars are present', () => {
    const c = loadConfig(validEnv);
    expect(c.r2.bucket).toBe('mool-recordings');
    expect(c.publicAppUrl).toBe('https://record.example.com');
  });

  it('defaults port to 3000', () => {
    expect(loadConfig(validEnv).port).toBe(3000);
  });

  it('defaults dataDir to ./data', () => {
    expect(loadConfig(validEnv).dataDir).toBe('./data');
  });

  it('defaults maxUploadBytes to 500 MB', () => {
    expect(loadConfig(validEnv).maxUploadBytes).toBe(524_288_000);
  });

  it('respects MAX_UPLOAD_BYTES override', () => {
    expect(loadConfig({ ...validEnv, MAX_UPLOAD_BYTES: '100' }).maxUploadBytes).toBe(100);
  });

  it('throws with the variable name when a required var is missing', () => {
    const { R2_BUCKET, ...partial } = validEnv;
    expect(() => loadConfig(partial)).toThrow(/R2_BUCKET/);
  });

  it('respects PORT override', () => {
    expect(loadConfig({ ...validEnv, PORT: '8080' }).port).toBe(8080);
  });

  it('throws when PORT is not an integer', () => {
    expect(() => loadConfig({ ...validEnv, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('throws when MAX_UPLOAD_BYTES is not an integer', () => {
    expect(() =>
      loadConfig({ ...validEnv, MAX_UPLOAD_BYTES: 'huge' }),
    ).toThrow(/MAX_UPLOAD_BYTES/);
  });
});

describe('loadConfig invariants', () => {
  it('throws when MAX_UPLOAD_BYTES is zero or negative', () => {
    expect(() => loadConfig({ ...validEnv, MAX_UPLOAD_BYTES: '0' })).toThrow(/MAX_UPLOAD_BYTES/);
    expect(() => loadConfig({ ...validEnv, MAX_UPLOAD_BYTES: '-1' })).toThrow(/MAX_UPLOAD_BYTES/);
  });

  it('throws when PORT is out of range', () => {
    expect(() => loadConfig({ ...validEnv, PORT: '0' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...validEnv, PORT: '70000' })).toThrow(/PORT/);
  });

  it('throws when a URL var is malformed', () => {
    expect(() => loadConfig({ ...validEnv, PUBLIC_APP_URL: 'not a url' })).toThrow(/PUBLIC_APP_URL/);
    expect(() => loadConfig({ ...validEnv, R2_ENDPOINT: 'no-scheme.example.com' })).toThrow(/R2_ENDPOINT/);
    expect(() => loadConfig({ ...validEnv, R2_PUBLIC_BASE_URL: '/relative' })).toThrow(/R2_PUBLIC_BASE_URL/);
  });

  it('strips trailing slashes from URL vars so callers can compose paths safely', () => {
    const c = loadConfig({
      ...validEnv,
      PUBLIC_APP_URL: 'https://record.example.com/',
      R2_PUBLIC_BASE_URL: 'https://videos.example.com///',
    });
    expect(c.publicAppUrl).toBe('https://record.example.com');
    expect(c.r2.publicBaseUrl).toBe('https://videos.example.com');
  });
});
