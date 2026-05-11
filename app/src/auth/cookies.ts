import type { CookieOptions } from 'express';

export interface SessionCookieOpts {
  maxAgeSeconds: number;
  secure: boolean;
}

/**
 * Attributes for the `mool_session` cookie. SameSite=Lax (not Strict) so the
 * magic-link cross-site GET from the email client carries the cookie on first
 * redirect. HttpOnly so client-side JS can't read the token.
 */
export function sessionCookieAttributes(opts: SessionCookieOpts): CookieOptions {
  return {
    httpOnly: true,
    secure: opts.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: opts.maxAgeSeconds * 1000,
  };
}

export const SESSION_COOKIE_NAME = 'mool_session';
