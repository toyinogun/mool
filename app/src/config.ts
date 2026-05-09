import path from 'node:path';
import { config as loadDotenv } from 'dotenv';

// Load .env from the repo root regardless of process cwd. This file lives at
// app/src/config.ts; two levels up is the repo root where .env sits next to
// docker-compose.yml. In Docker the env vars are already injected via
// env_file:, so this lookup silently no-ops when the file is absent.
loadDotenv({ path: path.resolve(__dirname, '..', '..', '.env') });

export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  publicBaseUrl: string;
}

export interface AppConfig {
  port: number;
  dataDir: string;
  maxUploadBytes: number;
  publicAppUrl: string;
  r2: R2Config;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const required = (name: string): string => {
    const v = env[name];
    if (!v) throw new Error(`Missing required env var: ${name}`);
    return v;
  };

  const intVar = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const parsed = parseInt(raw, 10);
    if (Number.isNaN(parsed)) {
      throw new Error(`Env var ${name} must be an integer, got: ${raw}`);
    }
    return parsed;
  };

  const positiveIntVar = (name: string, fallback: number): number => {
    const v = intVar(name, fallback);
    if (v <= 0) throw new Error(`Env var ${name} must be > 0, got: ${v}`);
    return v;
  };

  const portVar = (name: string, fallback: number): number => {
    const v = positiveIntVar(name, fallback);
    if (v > 65535) throw new Error(`Env var ${name} must be <= 65535, got: ${v}`);
    return v;
  };

  // Validates with the URL parser (catches typos like missing scheme) and
  // strips trailing slashes so callers can compose paths via `${base}/${seg}`
  // without thinking about doubled slashes.
  const urlVar = (name: string): string => {
    const raw = required(name);
    try {
      new URL(raw);
    } catch {
      throw new Error(`Env var ${name} must be a valid URL, got: ${raw}`);
    }
    return raw.replace(/\/+$/, '');
  };

  return {
    port: portVar('PORT', 3000),
    dataDir: env.DATA_DIR ?? './data',
    maxUploadBytes: positiveIntVar('MAX_UPLOAD_BYTES', 524_288_000),
    publicAppUrl: urlVar('PUBLIC_APP_URL'),
    r2: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
      bucket: required('R2_BUCKET'),
      endpoint: urlVar('R2_ENDPOINT'),
      publicBaseUrl: urlVar('R2_PUBLIC_BASE_URL'),
    },
  };
}
