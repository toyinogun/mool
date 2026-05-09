import express, {
  type Express,
  type Request,
  type Response,
  type NextFunction,
  type RequestHandler,
} from 'express';
import type { Recordings } from './recording';
import { createUploadRoute } from './routes/createUpload';
import { viewerRoute } from './routes/viewer';
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
  maxUploadBytes: number;
  viewerTemplate: string;
  /** Absolute path to the static-assets directory, or null in tests. */
  publicDir: string | null;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: '4kb' }));

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
  });

  app.get(VIEWER_ROUTE, asyncRoute(viewerRoute({
    recordings: deps.recordings,
    viewerTemplate: deps.viewerTemplate,
  })));
  app.post('/create-upload', asyncRoute(createUploadRoute({
    recordings: deps.recordings,
    maxUploadBytes: deps.maxUploadBytes,
  })));

  if (deps.publicDir) {
    app.use(express.static(deps.publicDir));
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
