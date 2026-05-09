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
});
