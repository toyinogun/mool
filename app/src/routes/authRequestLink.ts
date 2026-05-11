import type { Request, Response } from 'express';
import type { AuthStore } from '../auth/authStore';
import type { EmailSender } from '../email/sender';
import { generateToken, hashToken } from '../auth/tokens';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AuthRequestLinkDeps {
  authStore: AuthStore;
  emailSender: EmailSender;
  publicAppUrl: string;
  signinTokenTtlSeconds: number;
}

export function authRequestLinkRoute(deps: AuthRequestLinkDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const raw = req.body?.email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!email || !EMAIL_RE.test(email)) {
      res.status(204).end();
      return;
    }
    await deps.authStore.deleteUnconsumedSigninTokensForEmail(email);
    const token = generateToken();
    const expiresAt = new Date(Date.now() + deps.signinTokenTtlSeconds * 1000);
    await deps.authStore.insertSigninToken({ tokenHash: hashToken(token), email, expiresAt });
    const link = `${deps.publicAppUrl}/auth/callback?token=${token}`;
    await deps.emailSender.sendSigninLink({ to: email, link });
    res.status(204).end();
  };
}
