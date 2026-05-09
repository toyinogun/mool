# `Recording` is the domain entity; routes project to renderer/wire shapes

`Recordings.get(slug)` returns a `Recording` — the named domain entity from CONTEXT.md, shaped as `{ slug, r2Key, mimeType, createdAt }`. The Viewer route takes `publicUrl` as a dep and projects `Recording → { playbackUrl }` for the renderer. `RecordingView` is removed; `RecordingsDeps.publicUrl` is removed; `AppDeps` gains `publicUrl: (key: string) => string`.

## Why

ADR-0006 settled the create path's projection direction: the Recording module produces a domain `CreatedRecording`; the route owns `toWire`. The get path was asymmetric — Recording produced a presentation-shaped `RecordingView { slug, playbackUrl }` and the route unwrapped one field. To synthesise `playbackUrl`, Recording took `publicUrl: (key) => string` as a dep and called it on the read path. That asymmetry leaked a rendering concern into the domain module: Recording's contract included "knows where R2 serves bytes" even though R2 byte URLs are a presentation concern, not a Recording invariant.

CONTEXT.md names **Recording** as the conceptual entity — the row + R2-object pair, with the Recording module owning the mapping between them. Before this change, that name had no corresponding type in code; the closest types were `RecordingRow` (private), `CreatedRecording` (a creation result), and `RecordingView` (a render-time projection). Naming `Recording` in code closes the gap between the documented domain language and the type system, and lets a v0.4 caller (e.g. the account dashboard wanting `createdAt`) read stored fields without widening the interface.

Applying the deletion test to `RecordingView`: one consumer, one field, one path. Removing it concentrates no complexity — the projection moves to the route, where every other route → renderer/wire mapping already lives. `publicUrl` as a Recording dep was load-bearing in v0.1 only because `RecordingView` carried `playbackUrl`; with the projection moved, it is no longer Recording's concern.

## Considered Options

- **Return the raw row (`{ slug, r2Key, mimeType, createdAt }`) without naming it `Recording`.** Rejected: misses the chance to put the CONTEXT.md vocabulary into code. Future readers still triangulate the entity from comments and ADRs. Same shape as the chosen option, weaker name.
- **Return a narrow projection (`{ r2Key }` or `{ slug, r2Key }`) — minimum needed for playback.** Rejected: optimises a v0.1 cost (one field used today) at the cost of the entity's name. A type called `Recording` that exposes one field signals "I'm a lookup result, not the entity" — the worst of both worlds. Adding a v0.4 field then becomes an interface widening, the exact friction this ADR is closing.
- **Leave `RecordingView` in place; only move `publicUrl` out of `RecordingsDeps`.** Rejected: the move is impossible without changing the return shape — `RecordingView.playbackUrl` is computed by Recording from `publicUrl`, so removing the dep removes the field's source. Half-fixes are not on the table here.
- **Keep the asymmetry; revisit when v0.4 lands.** Rejected: the cost of the asymmetry (future readers triangulating why create projects in the route but get projects in Recording) compounds with each route added. Cheaper to pin the shape now, while there is one route per direction, than to remember the rule when v0.4's account-dashboard endpoints arrive.

## Relationship to ADR-0006 and ADR-0008

ADR-0006's reasoning is **extended symmetrically.** Its load-bearing claim — _"Recording produces a Recording. The route serializes."_ — applied to the create path; this ADR applies the same claim to the get path. The `toWire(...)` projection on create has a counterpart on get: the route reads `Recording.r2Key` and computes `playbackUrl` for the renderer.

ADR-0008's casual statement that "the route reads `view.playbackUrl` and passes it" is **superseded.** ADR-0008's load-bearing decision was about the rendering layer's input shape — `{ playbackUrl }`, not the storage shape — and that decision survives unchanged: the renderer still takes `{ playbackUrl }`. What changes is who computes `playbackUrl`: was Recording, is now the route, the same place that computes wire shapes.

ADR-0005's split of `mintUploadUrl` and `publicUrl` as independent function deps is **preserved.** `r2.ts` continues to expose both; the composition root (per ADR-0011) continues to wire them. The change is which module each is plumbed _into_: `mintUploadUrl` stays in `RecordingsDeps`; `publicUrl` moves to `AppDeps`, alongside `renderViewerPage` (the existing function-dep on the rendering side).

## Consequences

The Recording module no longer knows the public-URL contract. Its deps signature is `{ dbPath, mintUploadUrl, viewerUrl, generateSlug? }` — every member is something Recording genuinely uses across its own code paths. `publicUrl` becomes an `AppDeps` function dep, plumbed via `compose()` from `leaves.publicUrl` and threaded into `viewerRoute({ recordings, renderViewerPage, publicUrl })` by `createApp`.

`tests/recording.test.ts` keeps every existing assertion except the playback-URL composition test, which moves to `tests/viewer.test.ts` (where the route's projection now lives). `tests/viewerPage.test.ts` and `tests/contracts.test.ts` are unaffected. `tests/helpers/testApp.ts` adds `publicUrl` to its compose-leaves construction, symmetric with how `mintUploadUrl` is already wired.
