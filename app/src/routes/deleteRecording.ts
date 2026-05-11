import type { Request, Response } from 'express';
import type { Recordings } from '../recording';

export interface DeleteRecordingDeps {
  recordings: Recordings;
  deleteObject: (key: string) => Promise<void>;
}

export function deleteRecordingRoute(deps: DeleteRecordingDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const slug = req.params.slug;
    const userId = req.user!.id;
    const row = await deps.recordings.get(slug);
    if (!row || row.userId !== userId) {
      res.status(404).end();
      return;
    }
    try {
      await deps.deleteObject(row.r2Key);
    } catch (err) {
      console.error('r2 delete failed', err);
      res.status(502).json({ error: 'r2_delete_failed' });
      return;
    }
    await deps.recordings.deleteForUser({ slug, userId });
    res.status(204).end();
  };
}
