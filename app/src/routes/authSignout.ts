import type { Request, Response } from 'express';
import type { AuthStore } from '../auth/authStore';
import { hashToken } from '../auth/tokens';
import { sessionCookieAttributes, SESSION_COOKIE_NAME } from '../auth/cookies';

export interface AuthSignoutDeps {
  authStore: AuthStore;
  cookieSecure: boolean;
}

export function authSignoutRoute(deps: AuthSignoutDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const raw = req.cookies?.[SESSION_COOKIE_NAME];
    if (typeof raw === 'string' && raw.length > 0) {
      await deps.authStore.deleteSession(hashToken(raw));
    }
    res.cookie(SESSION_COOKIE_NAME, '', sessionCookieAttributes({ maxAgeSeconds: 0, secure: deps.cookieSecure }));
    res.redirect(302, '/signin');
  };
}
