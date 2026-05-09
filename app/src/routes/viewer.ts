import type { Request, Response } from 'express';
import type { Recordings, RecordingView } from '../recording';

export interface ViewerDeps {
  recordings: Recordings;
  viewerTemplate: string;
}

export function viewerRoute(deps: ViewerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { slug } = req.params;
    let view: RecordingView | null;
    try {
      view = await deps.recordings.get(slug);
    } catch (err) {
      // The default Express error handler emits JSON, which would render as
      // raw text in a browser tab opened on the Viewer page. Catch here so
      // the failure mode matches the Viewer's content-type contract.
      console.error('viewer route failed:', err);
      res.status(500).type('text/plain').send('Recording temporarily unavailable');
      return;
    }
    if (!view) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    // Bind to a const so the replacer closure (below) doesn't see `view`
    // widened back to `RecordingView | null`.
    const { playbackUrl } = view;
    // Replacer function avoids $-interpretation in the replacement string,
    // so URLs containing $ characters substitute literally.
    const html = deps.viewerTemplate.replace(/\{\{PLAYBACK_URL\}\}/g, () => playbackUrl);
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  };
}
