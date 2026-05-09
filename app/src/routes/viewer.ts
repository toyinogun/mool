import type { Request, Response } from 'express';
import type { Recordings } from '../recording';

export interface ViewerDeps {
  recordings: Recordings;
  viewerTemplate: string;
}

export function viewerRoute(deps: ViewerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { slug } = req.params;
    const view = await deps.recordings.get(slug);
    if (!view) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    // Replacer function avoids $-interpretation in the replacement string,
    // so URLs containing $ characters substitute literally.
    const html = deps.viewerTemplate.replace(/\{\{VIDEO_URL\}\}/g, () => view.videoUrl);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  };
}
