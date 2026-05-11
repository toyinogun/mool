import type { Request, Response } from 'express';
import type { Recordings } from '../recording';

export interface LibraryPageDeps {
  recordings: Recordings;
  renderLibraryPage: (inputs: { recordingsJson: string }) => string;
}

const FIRST_PAGE = 50;

export function libraryPageRoute(deps: LibraryPageDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const items = await deps.recordings.listForUser({ userId: req.user!.id, limit: FIRST_PAGE });
    const payload = items.map((r) => ({
      slug: r.slug,
      createdAt: r.createdAt.toISOString(),
      mimeType: r.mimeType,
    }));
    const recordingsJson = JSON.stringify(payload);
    res.type('text/html').send(deps.renderLibraryPage({ recordingsJson }));
  };
}
