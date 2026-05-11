import { Resend } from 'resend';

export interface EmailSender {
  sendSigninLink(args: { to: string; link: string }): Promise<void>;
}

export interface ResendSenderOpts {
  apiKey: string;
  from: string;
}

export function createResendSender(opts: ResendSenderOpts): EmailSender {
  const resend = new Resend(opts.apiKey);
  return {
    async sendSigninLink({ to, link }) {
      const { error } = await resend.emails.send({
        from: opts.from,
        to,
        subject: 'Sign in to Mool',
        text:
          `Click the link below to sign in to Mool. The link is valid for 15 minutes and can only be used once.\n\n${link}\n\nIf you didn't request this, you can ignore this email.\n`,
        html:
          `<p>Click the link below to sign in to Mool. The link is valid for 15 minutes and can only be used once.</p>` +
          `<p><a href="${link}">${link}</a></p>` +
          `<p>If you didn't request this, you can ignore this email.</p>`,
      });
      if (error) throw new Error(`resend_failed: ${error.message}`);
    },
  };
}

export interface FakeEmailSender extends EmailSender {
  readonly sent: ReadonlyArray<{ to: string; link: string }>;
}

export function createFakeEmailSender(opts: { throwOnSend?: Error } = {}): FakeEmailSender {
  const sent: Array<{ to: string; link: string }> = [];
  return {
    sent,
    async sendSigninLink({ to, link }) {
      if (opts.throwOnSend) throw opts.throwOnSend;
      sent.push({ to, link });
    },
  };
}
