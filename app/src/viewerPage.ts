/**
 * Owner of the Viewer page's HTML rendering.
 *
 * Holds the template (loaded once at composition root) and renders it with
 * the per-request slot values. This module exists so the substitution logic
 * lives next to the template's contract — adding a v0.5 placeholder is a
 * single-file change here, type-checked at the slot signature, instead of
 * a regex addition in the route + a stub update in tests + a residue
 * regex update in another test file.
 *
 * The Recording module produces a Recording (`RecordingView`); the route
 * extracts the slot values it needs and calls `renderViewerPage` — the
 * rendering layer doesn't take the domain entity, only the slot list, so
 * the storage shape and the rendering contract evolve independently.
 */

export interface CreateViewerPageDeps {
  /** The Viewer page HTML template, with `{{PLAYBACK_URL}}` placeholders. */
  template: string;
}

export function createViewerPage(deps: CreateViewerPageDeps) {
  return {
    renderViewerPage({ playbackUrl }: { playbackUrl: string }): string {
      // Replacer function avoids $-interpretation in the replacement string,
      // so URLs containing $ characters substitute literally.
      return deps.template.replace(/\{\{PLAYBACK_URL\}\}/g, () => playbackUrl);
    },
  };
}
