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

  it('returns 200 with {ok: true} when db is reachable', async () => {
    const { app, cleanup } = buildTestApp({ dbHealth: async () => true });
    try {
      const r = await request(app).get('/healthz');
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });
    } finally { cleanup(); }
  });

  it('returns 503 when dbHealth throws', async () => {
    const { app, cleanup } = buildTestApp({ dbHealth: async () => { throw new Error('down'); } });
    try {
      const r = await request(app).get('/healthz');
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ ok: false });
    } finally { cleanup(); }
  });

  it('returns 503 when dbHealth returns false', async () => {
    const { app, cleanup } = buildTestApp({ dbHealth: async () => false });
    try {
      const r = await request(app).get('/healthz');
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ ok: false });
    } finally { cleanup(); }
  });
});
