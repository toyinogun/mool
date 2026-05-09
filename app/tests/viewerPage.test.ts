import { describe, it, expect } from 'vitest';
import { createViewerPage } from '../src/viewerPage';

describe('createViewerPage.renderViewerPage', () => {
  it('substitutes {{PLAYBACK_URL}} with the supplied playbackUrl', () => {
    const { renderViewerPage } = createViewerPage({
      template: '<video src="{{PLAYBACK_URL}}"></video>',
    });
    const html = renderViewerPage({ playbackUrl: 'https://r2.example.com/abc.webm' });
    expect(html).toBe('<video src="https://r2.example.com/abc.webm"></video>');
  });

  it('substitutes every occurrence, not just the first', () => {
    const { renderViewerPage } = createViewerPage({
      template: '<a href="{{PLAYBACK_URL}}"></a><b>{{PLAYBACK_URL}}</b>',
    });
    const html = renderViewerPage({ playbackUrl: 'X' });
    expect(html).toBe('<a href="X"></a><b>X</b>');
  });

  it('inserts URLs containing $ literally (no RegExp $-pattern interpretation)', () => {
    // Pins the replacer-closure invariant — passing a function to .replace
    // bypasses $&/$1/etc. patterns, so signatures with `$` characters land
    // verbatim. A naive string replacement would corrupt them.
    const { renderViewerPage } = createViewerPage({
      template: '<video src="{{PLAYBACK_URL}}"></video>',
    });
    const html = renderViewerPage({
      playbackUrl: 'https://r2.example.com/x.webm?sig=$1$&',
    });
    expect(html).toBe(
      '<video src="https://r2.example.com/x.webm?sig=$1$&"></video>',
    );
  });

  it('leaves no {{IDENT}} markers in the output for the v0.1 template shape', () => {
    // Catches the silent-typo hazard the day a second placeholder lands in
    // viewer.html: if the rendering forgets to substitute it, the residue
    // check fires here instead of shipping a literal '{{TITLE}}' to users.
    const { renderViewerPage } = createViewerPage({
      template:
        '<!doctype html><html><body><video src="{{PLAYBACK_URL}}"></video></body></html>',
    });
    const html = renderViewerPage({ playbackUrl: 'https://r2.example.com/x.webm' });
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });
});
