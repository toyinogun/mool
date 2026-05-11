import type { Request, Response } from 'express';
import type { AuthStore } from '../auth/authStore';
import { hashToken, generateToken } from '../auth/tokens';
import { sessionCookieAttributes, SESSION_COOKIE_NAME } from '../auth/cookies';

const INVALID_PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><title>Sign-in link invalid</title></head>
<body><h1>This sign-in link is invalid or expired.</h1>
<p><a href="/signin">Request a new link</a></p></body></html>`;

export interface AuthCallbackDeps {
  authStore: AuthStore;
  sessionTtlSeconds: number;
  cookieSecure: boolean;
}

export function authCallbackRoute(deps: AuthCallbackDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const raw = req.query.token;
    if (typeof raw !== 'string' || raw.length === 0) {
      res.status(400).type('text/html').send(INVALID_PAGE);
      return;
    }
    const hash = hashToken(raw);
    const row = await deps.authStore.findSigninTokenByHash(hash);
    if (!row || row.consumedAt !== null || row.expiresAt < new Date()) {
      res.status(400).type('text/html').send(INVALID_PAGE);
      return;
    }
    await deps.authStore.consumeSigninToken(hash);
    const localPart = row.email.split('@')[0];
    const user = await deps.authStore.upsertUserByEmail({ email: row.email, displayName: localPart });

    const sessionToken = generateToken();
    const sessionExpiresAt = new Date(Date.now() + deps.sessionTtlSeconds * 1000);
    await deps.authStore.insertSession({ tokenHash: hashToken(sessionToken), userId: user.id, expiresAt: sessionExpiresAt });

    res.cookie(SESSION_COOKIE_NAME, sessionToken, sessionCookieAttributes({
      maxAgeSeconds: deps.sessionTtlSeconds,
      secure: deps.cookieSecure,
    }));
    res.redirect(302, '/');
  };
}
