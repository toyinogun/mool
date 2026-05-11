import type { Request, Response } from 'express';
import type { Recordings } from '../recording';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export interface ListRecordingsDeps { recordings: Recordings; }

export function listRecordingsRoute(deps: ListRecordingsDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const userId = req.user!.id;
    const rawLimit = parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : DEFAULT_LIMIT;
    const rawBefore = req.query.before;
    let before: Date | undefined;
    if (typeof rawBefore === 'string' && rawBefore.length > 0) {
      const t = Date.parse(rawBefore);
      if (Number.isNaN(t)) {
        res.status(400).json({ error: 'invalid_before' });
        return;
      }
      before = new Date(t);
    }
    const items = await deps.recordings.listForUser({ userId, limit, before });
    res.json({
      items: items.map((r) => ({
        slug: r.slug,
        createdAt: r.createdAt.toISOString(),
        mimeType: r.mimeType,
      })),
    });
  };
}
