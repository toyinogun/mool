import type { Request, Response, NextFunction, RequestHandler } from 'express';
import type { AuthStore, User } from './authStore';
import { hashToken } from './tokens';
import { SESSION_COOKIE_NAME } from './cookies';

export interface RequireSessionOpts {
  authStore: AuthStore;
  /** `html` 302s to `signinUrl`; `json` returns 401 with `{error:'unauthenticated'}`. */
  mode: 'html' | 'json';
  /** Absolute URL of the sign-in page (only used in `html` mode). */
  signinUrl: string;
}

export function requireSession(opts: RequireSessionOpts): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    const raw = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof raw !== 'string' || raw.length === 0) {
      reject(res, opts);
      return;
    }
    try {
      const session = await opts.authStore.findSessionByHash(hashToken(raw));
      if (!session) {
        reject(res, opts);
        return;
      }
      req.user = session.user;
      next();
    } catch (err) {
      next(err);
    }
  };
}

function reject(res: Response, opts: RequireSessionOpts): void {
  if (opts.mode === 'html') {
    res.redirect(302, opts.signinUrl);
  } else {
    res.status(401).json({ error: 'unauthenticated' });
  }
}
