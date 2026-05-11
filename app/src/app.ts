import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import cookieParser from 'cookie-parser';
import type { Recordings } from './recording';
import type { AuthStore } from './auth/authStore';
import type { EmailSender } from './email/sender';
import { createUploadRoute } from './routes/createUpload';
import { viewerRoute } from './routes/viewer';
import { authRequestLinkRoute } from './routes/authRequestLink';
import { authCallbackRoute } from './routes/authCallback';
import { authSignoutRoute } from './routes/authSignout';
import { meRoute } from './routes/me';
import { requireSession } from './auth/requireSession';
import { VIEWER_ROUTE } from './urls';

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async route handler so rejected promises flow into Express's
 * error-handling middleware. Express 4 only catches synchronous throws.
 */
export function asyncRoute(fn: AsyncHandler): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export interface AppDeps {
  recordings: Recordings;
  authStore: AuthStore;
  emailSender: EmailSender;
  maxUploadBytes: number;
  renderViewerPage: (inputs: { playbackUrl: string }) => string;
  /** Builds the public URL where R2 serves a stored object's bytes. See ADR-0015. */
  publicUrl: (key: string) => string;
  /** Absolute path to the static-assets directory, or null in tests. */
  publicDir: string | null;
  /** Mool's public-facing app URL, e.g. `https://record.example.com`. */
  publicAppUrl: string;
  /** How long a magic-link signin token is valid for, in seconds. */
  signinTokenTtlSeconds: number;
  /** How long a session cookie is valid for, in seconds. */
  sessionTtlSeconds: number;
  /** Whether to set the Secure flag on the session cookie. */
  cookieSecure: boolean;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '4kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get(VIEWER_ROUTE, asyncRoute(viewerRoute({
    recordings: deps.recordings,
    renderViewerPage: deps.renderViewerPage,
    publicUrl: deps.publicUrl,
  })));
  app.post('/create-upload', asyncRoute(createUploadRoute({
    recordings: deps.recordings,
    maxUploadBytes: deps.maxUploadBytes,
  })));
  app.post('/auth/request-link', asyncRoute(authRequestLinkRoute({
    authStore: deps.authStore,
    emailSender: deps.emailSender,
    publicAppUrl: deps.publicAppUrl,
    signinTokenTtlSeconds: deps.signinTokenTtlSeconds,
  })));
  app.get('/auth/callback', asyncRoute(authCallbackRoute({
    authStore: deps.authStore,
    sessionTtlSeconds: deps.sessionTtlSeconds,
    cookieSecure: deps.cookieSecure,
  })));

  const signinUrl = `${deps.publicAppUrl}/signin`;
  const requireSessionHtml = requireSession({ authStore: deps.authStore, mode: 'html', signinUrl });
  const requireSessionJson = requireSession({ authStore: deps.authStore, mode: 'json', signinUrl: '' });

  // Gated recorder page — must come before express.static so unauthenticated
  // requests to / are redirected instead of falling through to static.
  app.get('/', requireSessionHtml, (_req, res, next) => {
    if (!deps.publicDir) return next();
    res.sendFile('index.html', { root: deps.publicDir });
  });

  app.post('/auth/signout', asyncRoute(authSignoutRoute({
    authStore: deps.authStore,
    cookieSecure: deps.cookieSecure,
  })));
  app.get('/me', requireSessionJson, meRoute());

  // Static middleware — serves all assets except index.html so / is gated above.
  if (deps.publicDir) {
    app.use(express.static(deps.publicDir, { index: false }));
  }

  app.use(
    (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      console.error(err);
      if (res.headersSent) return;
      res.status(500).json({ error: 'internal_server_error' });
    },
  );

  return app;
}
