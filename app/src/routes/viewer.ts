import type { Request, Response } from 'express';
import type { Recordings, RecordingView } from '../recording';

export interface ViewerDeps {
  recordings: Recordings;
  renderViewerPage: (inputs: { playbackUrl: string }) => string;
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
    const html = deps.renderViewerPage({ playbackUrl: view.playbackUrl });
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  };
}
