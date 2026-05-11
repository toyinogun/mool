import { describe, it, expect } from 'vitest';
import { createFakeEmailSender } from '../../src/email/sender';

describe('fake EmailSender', () => {
  it('records sent links', async () => {
    const sender = createFakeEmailSender();
    await sender.sendSigninLink({ to: 'a@b.com', link: 'https://record.example.com/auth/callback?token=xyz' });
    expect(sender.sent).toEqual([{ to: 'a@b.com', link: 'https://record.example.com/auth/callback?token=xyz' }]);
  });

  it('throwsOnSend simulates Resend failure', async () => {
    const sender = createFakeEmailSender({ throwOnSend: new Error('resend-failed') });
    await expect(sender.sendSigninLink({ to: 'a@b.com', link: 'x' })).rejects.toThrow('resend-failed');
    expect(sender.sent).toEqual([]);
  });
});
