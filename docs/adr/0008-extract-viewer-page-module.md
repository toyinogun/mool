# Extract `viewerPage.ts`; the route does not own template substitution

The Viewer page's HTML template (loaded once at the composition root) and the `{{PLAYBACK_URL}}` substitution live together in `app/src/viewerPage.ts`. `createViewerPage({ template })` returns `{ renderViewerPage({ playbackUrl }): string }`. `AppDeps` no longer carries `viewerTemplate: string` — it carries `renderViewerPage` as a function dep. The route calls `deps.renderViewerPage({ playbackUrl: view.playbackUrl })` and serves the result. `server.ts` continues to own the `readFileSync(...)` of `views/viewer.html` and passes the loaded string into `createViewerPage`.

## Why

Before this change, the Viewer page's rendering contract was distributed across four files: the template at `views/viewer.html`, the `readFileSync` at `server.ts`, the regex substitution inline in `routes/viewer.ts`, and a hand-written stub template in `tests/helpers/testApp.ts`. With one placeholder today the friction was small, but the test at `tests/viewer.test.ts` already pinned `expect(res.text).not.toMatch(/\{\{[A-Z_]+\}\}/)` — explicitly hedging against the silent-typo hazard the day a second placeholder lands at v0.5 (thumbnails) or v0.6 (titles). The hedge was the signal: future friction is anticipated, not hypothetical.

Applying the deletion test on the proposed module: removing `viewerPage.ts` would re-distribute the substitution back across four files, and a v0.5 placeholder addition would touch every one of them (template, route, route test stub, residue regex). Keeping the module concentrates the rendering contract — adding a new slot is one new arg in the rendering function's input type, one new substitution call in the same file, one new test next to the others. **Locality** wins; the **interface is the test surface**.

The rendering layer's interface is the slot list (`{ playbackUrl }`), not the `RecordingView` domain entity. The route is the place that maps domain → rendering inputs — same reasoning as ADR-0003's stripping of `publicAppUrl` from `RecordingsDeps`: the rendering layer has no business knowing the storage shape, and decoupling them lets each evolve independently. The route reads `view.playbackUrl` and passes it; the rendering layer types `{ playbackUrl: string }`.

## Considered Options

- **Leave inline; revisit at v0.5.** Rejected: the friction is anticipated by an existing test pin, the deepening cost is small (one new file, four new tests), and the v0.5 alternative is touching four files at the moment of placeholder addition. Cheaper to deepen now than to remember the rule when it's needed.
- **Pass the `RecordingView` domain entity to the renderer.** Rejected: couples the rendering layer to the storage shape. A v0.4 change to `RecordingView` (e.g. adding `createdAt`) would force a rendering-layer signature change for a field the template doesn't use. Same anti-pattern as Recording knowing `publicAppUrl` (ADR-0003).
- **Have `viewerPage.ts` read its own template from disk** at construction. Rejected: filesystem in the rendering layer is the wrong direction. The composition root (`server.ts`) owns "where files live"; tests pass strings directly without knowing about disk. Symmetric with `createRecordings({ dbPath })` taking the path but not knowing about `__dirname`.
- **Define a `ViewerPage` interface type for the factory return.** Rejected: one production caller, one test consumer, one method. The deletion-test outcome is the same as ADR-0005's drop of the `R2` interface — the named type adds a layer with no leverage. Consumers destructure `{ renderViewerPage }` from the factory result; `AppDeps` types the function inline.
- **Take `renderViewerPage` as part of `RecordingsDeps` instead of `AppDeps`.** Rejected: same shape error as ADR-0003 considered for the Viewer URL — Recording produces a Recording, not HTML. Rendering is mounted by the route, not the domain module.

## Consequences

- Adding a v0.5 placeholder (e.g. `{{TITLE}}`) is a single-file change in `viewerPage.ts`: one new arg in the input type, one new `replace(...)` call, one new test. Route, `AppDeps`, `testApp.ts`, and `viewer.test.ts` are untouched.
- The placeholder-residue check (`not.toMatch(/\{\{[A-Z_]+\}\}/)`) moved from `tests/viewer.test.ts` to `tests/viewerPage.test.ts` — closer to the rendering it pins. The route test now asserts only route-shaped concerns: status, content-type, presence of the playback URL.
- The replacer-closure invariant (URLs containing `$` substitute literally, not as `$&`/`$1` patterns) is now an explicit test in `tests/viewerPage.test.ts` instead of an implicit property of the route.
- `server.ts` keeps the `readFileSync`. The composition root continues to be the only place that knows `views/viewer.html` exists on disk.
- **Future grouping urge**: if a v0.4+ change adds a second template (e.g. an embed page or an OG-preview card), prefer a sibling module (`embedPage.ts`) rather than widening `viewerPage.ts` to multiple templates. Same rule as ADR-0006 / ADR-0007 — domain-named modules per cluster, not a generic "page renderer" wrapper.
