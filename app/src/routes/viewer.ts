import type { Request, Response } from 'express';
import type { Recording, Recordings } from '../recording';

export interface ViewerDeps {
  recordings: Recordings;
  renderViewerPage: (inputs: { playbackUrl: string }) => string;
  mintViewUrl: (args: { key: string; ttlSeconds: number }) => Promise<string>;
  viewUrlTtlSeconds: number;
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
    let playbackUrl: string;
    try {
      playbackUrl = await deps.mintViewUrl({ key: recording.r2Key, ttlSeconds: deps.viewUrlTtlSeconds });
    } catch (err) {
      console.error('mintViewUrl failed:', err);
      res.status(502).type('text/plain').send('Recording temporarily unavailable');
      return;
    }
    const html = deps.renderViewerPage({ playbackUrl });
    res.set('Content-Type', 'text/html; charset=utf-8').send(html);
  };
}
