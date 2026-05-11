import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';
import { createFakeEmailSender } from '../src/email/sender';

describe('POST /auth/request-link', () => {
  it('returns 204 for a valid email and queues a sent message', async () => {
    const { app, emailSender, cleanup } = buildTestApp();
    try {
      const r = await request(app).post('/auth/request-link').send({ email: 'A@B.com' });
      expect(r.status).toBe(204);
      expect(emailSender.sent.length).toBe(1);
      expect(emailSender.sent[0].to).toBe('a@b.com');
      expect(emailSender.sent[0].link).toMatch(/^https:\/\/record\.example\.com\/auth\/callback\?token=[A-Za-z0-9_-]{43}$/);
    } finally { cleanup(); }
  });

  it('returns 204 with no email sent for malformed input', async () => {
    const { app, emailSender, cleanup } = buildTestApp();
    try {
      const r = await request(app).post('/auth/request-link').send({ email: 'not-an-email' });
      expect(r.status).toBe(204);
      expect(emailSender.sent).toEqual([]);
    } finally { cleanup(); }
  });

  it('drops any existing unconsumed signin tokens for the same email before issuing a new one', async () => {
    const { app, emailSender, cleanup } = buildTestApp();
    try {
      await request(app).post('/auth/request-link').send({ email: 'a@b.com' });
      const firstLink = emailSender.sent[0].link;
      await request(app).post('/auth/request-link').send({ email: 'a@b.com' });
      const secondLink = emailSender.sent[1].link;
      expect(firstLink).not.toBe(secondLink);
    } finally { cleanup(); }
  });

  it('returns 500 when the email sender throws (so client knows to retry)', async () => {
    const failing = createFakeEmailSender({ throwOnSend: new Error('boom') });
    const { app, cleanup } = buildTestApp({ emailSender: failing });
    try {
      const r = await request(app).post('/auth/request-link').send({ email: 'a@b.com' });
      expect(r.status).toBe(500);
    } finally { cleanup(); }
  });
});
