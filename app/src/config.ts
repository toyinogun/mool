export interface R2Config {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
}

export interface ResendConfig {
  apiKey: string;
  from: string;
}

export interface AppConfig {
  port: number;
  dataDir: string;
  maxUploadBytes: number;
  publicAppUrl: string;
  databaseUrl: string;
  r2: R2Config;
  resend: ResendConfig;
  signinTokenTtlSeconds: number;
  sessionTtlSeconds: number;
  viewUrlTtlSeconds: number;
  cookieSecure: boolean;
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

  const urlVar = (name: string): string => {
    const raw = required(name);
    try { new URL(raw); }
    catch { throw new Error(`Env var ${name} must be a valid URL, got: ${raw}`); }
    return raw.replace(/\/+$/, '');
  };

  const boolVar = (name: string, fallback: boolean): boolean => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    throw new Error(`Env var ${name} must be "true" or "false", got: ${raw}`);
  };

  return {
    port: portVar('PORT', 3000),
    dataDir: env.DATA_DIR ?? './data',
    maxUploadBytes: positiveIntVar('MAX_UPLOAD_BYTES', 524_288_000),
    publicAppUrl: urlVar('PUBLIC_APP_URL'),
    databaseUrl: required('DATABASE_URL'),
    r2: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
      bucket: required('R2_BUCKET'),
      endpoint: urlVar('R2_ENDPOINT'),
    },
    resend: {
      apiKey: required('RESEND_API_KEY'),
      from: required('RESEND_FROM'),
    },
    signinTokenTtlSeconds: positiveIntVar('SIGNIN_TOKEN_TTL_SECONDS', 900),
    sessionTtlSeconds: positiveIntVar('SESSION_TTL_SECONDS', 2592000),
    viewUrlTtlSeconds: positiveIntVar('VIEW_URL_TTL_SECONDS', 3600),
    cookieSecure: boolVar('COOKIE_SECURE', true),
  };
}
