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

  return {
    port: parseInt(env.PORT ?? '3000', 10),
    dataDir: env.DATA_DIR ?? './data',
    maxUploadBytes: parseInt(env.MAX_UPLOAD_BYTES ?? '524288000', 10),
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
