import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { buildTestApp } from './helpers/testApp';

describe('GET /healthz', () => {
  it('returns 200 with { ok: true }', async () => {
    const { app, cleanup } = buildTestApp();
    try {
      const res = await request(app).get('/healthz');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    } finally {
      cleanup();
    }
  });
});
