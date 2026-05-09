import type { Request, Response } from 'express';
import type { DB } from '../db';
import type { R2 } from '../r2';
import { SLUG_LENGTH } from '../slug';

const SLUG_RE = new RegExp(`^[A-Za-z0-9]{${SLUG_LENGTH}}$`);

export interface ViewerDeps {
  db: DB;
  r2: R2;
  viewerTemplate: string;
}

export function viewerRoute(deps: ViewerDeps) {
  return (req: Request, res: Response): void => {
    const { slug } = req.params;
    if (!SLUG_RE.test(slug)) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const rec = deps.db.getRecording(slug);
    if (!rec) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const videoUrl = deps.r2.publicUrl(rec.r2Key);
    // Replacer function avoids $-interpretation in the replacement string,
    // so URLs containing $ characters substitute literally.
    const html = deps.viewerTemplate.replace(/\{\{VIDEO_URL\}\}/g, () => videoUrl);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  };
}
