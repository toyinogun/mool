import type { Request, Response } from 'express';
import type { Recording, Recordings } from '../recording';

export interface ViewerDeps {
  recordings: Recordings;
  renderViewerPage: (inputs: { playbackUrl: string }) => string;
  /** Builds the public URL where R2 serves a stored object's bytes. See ADR-0015. */
  publicUrl: (key: string) => string;
}

export function viewerRoute(deps: ViewerDeps) {
  return async (req: Request, res: Response): Promise<void> => {
    const { slug } = req.params;
    let recording: Recording | null;
    try {
      recording = await deps.recordings.get(slug);
    } catch (err) {
      // The default Express error handler emits JSON, which would render as
      // raw text in a browser tab opened on the Viewer page. Catch here so
      // the failure mode matches the Viewer's content-type contract.
      console.error('viewer route failed:', err);
      res.status(500).type('text/plain').send('Recording temporarily unavailable');
      return;
    }
    if (!recording) {
      res.status(404).type('text/plain').send('Not found');
      return;
    }
    const playbackUrl = deps.publicUrl(recording.r2Key);
    const html = deps.renderViewerPage({ playbackUrl });
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  };
}
