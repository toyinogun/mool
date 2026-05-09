import { config as loadDotenv } from 'dotenv';

loadDotenv();

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

  return {
    port: intVar('PORT', 3000),
    dataDir: env.DATA_DIR ?? './data',
    maxUploadBytes: intVar('MAX_UPLOAD_BYTES', 524_288_000),
    publicAppUrl: required('PUBLIC_APP_URL'),
    r2: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
      bucket: required('R2_BUCKET'),
      endpoint: required('R2_ENDPOINT'),
      publicBaseUrl: required('R2_PUBLIC_BASE_URL'),
    },
  };
}
