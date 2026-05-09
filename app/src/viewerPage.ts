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
 * The Recording module produces a `Recording` (the domain entity per ADR-0015);
 * the route extracts the slot values it needs and calls `renderViewerPage` —
 * the rendering layer doesn't take the domain entity, only the slot list, so
 * the storage shape and the rendering contract evolve independently.
 */

export interface CreateViewerPageDeps {
  /** The Viewer page HTML template, with `{{PLAYBACK_URL}}` placeholders. */
  template: string;
}

/**
 * Placeholders the renderer fills. Every slot must appear at least once in
 * the template, and the template may not carry any `{{IDENT}}` markers
 * outside this set — see ADR-0016.
 */
const REQUIRED_SLOTS = ['PLAYBACK_URL'] as const;
const PLACEHOLDER_RE = /\{\{([A-Z_]+)\}\}/g;

export class ViewerTemplateInvalidError extends Error {
  readonly missing: readonly string[];
  readonly unknown: readonly string[];
  constructor({ missing, unknown }: { missing: readonly string[]; unknown: readonly string[] }) {
    super(
      `Viewer template placeholder mismatch — missing: [${missing.join(', ')}], unknown: [${unknown.join(', ')}]`,
    );
    this.name = 'ViewerTemplateInvalidError';
    this.missing = missing;
    this.unknown = unknown;
  }
}

export function createViewerPage(deps: CreateViewerPageDeps) {
  const present = new Set<string>();
  for (const m of deps.template.matchAll(PLACEHOLDER_RE)) present.add(m[1]);
  const missing = REQUIRED_SLOTS.filter((s) => !present.has(s));
  const unknown = [...present].filter(
    (s) => !(REQUIRED_SLOTS as readonly string[]).includes(s),
  );
  if (missing.length || unknown.length) {
    throw new ViewerTemplateInvalidError({ missing, unknown });
  }

  return {
    renderViewerPage({ playbackUrl }: { playbackUrl: string }): string {
      // Replacer function avoids $-interpretation in the replacement string,
      // so URLs containing $ characters substitute literally.
      return deps.template.replace(/\{\{PLAYBACK_URL\}\}/g, () => playbackUrl);
    },
  };
}
