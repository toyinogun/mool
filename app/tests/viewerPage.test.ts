import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createViewerPage, ViewerTemplateInvalidError } from '../src/viewerPage';

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

});

describe('createViewerPage template validation (ADR-0016)', () => {
  it('throws ViewerTemplateInvalidError when a required slot is missing', () => {
    expect(() =>
      createViewerPage({
        template: '<!doctype html><html><body><video></video></body></html>',
      }),
    ).toThrow(ViewerTemplateInvalidError);
  });

  it('reports the missing slot name on the error', () => {
    let err: unknown;
    try {
      createViewerPage({ template: '<html><body></body></html>' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ViewerTemplateInvalidError);
    expect((err as ViewerTemplateInvalidError).missing).toEqual(['PLAYBACK_URL']);
    expect((err as ViewerTemplateInvalidError).unknown).toEqual([]);
  });

  it('throws when the template carries an unknown placeholder', () => {
    // A v0.5 placeholder added to the HTML before the renderer is updated —
    // boot fails loud instead of shipping a literal '{{TITLE}}' to users.
    let err: unknown;
    try {
      createViewerPage({
        template: '<video src="{{PLAYBACK_URL}}"></video><h1>{{TITLE}}</h1>',
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ViewerTemplateInvalidError);
    expect((err as ViewerTemplateInvalidError).missing).toEqual([]);
    expect((err as ViewerTemplateInvalidError).unknown).toEqual(['TITLE']);
  });

  it('accepts the production app/src/views/viewer.html as a valid template', () => {
    // Single CI smoke test against the real prod template — without this, the
    // construction-time validation only fires at server boot, not on PR.
    const template = readFileSync(
      path.join(__dirname, '../src/views/viewer.html'),
      'utf8',
    );
    expect(() => createViewerPage({ template })).not.toThrow();
  });
});
