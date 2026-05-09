# Defer the `compose()` extraction; `server.ts` and `testApp.ts` continue to wire independently

The composition-root duplication between `app/src/server.ts` and `app/tests/helpers/testApp.ts` is acknowledged and **deliberately left in place at v0.1**. Both files independently construct `urls`, `Recordings`, the viewer-page renderer, and the Express app, differing only on leaves (real R2 vs fake, real db path vs `:memory:`, real template vs a stub, real `publicDir` vs `null`). A future `compose({ leaves })` extraction is a known candidate but does not yet earn its keep.

## Why

Applying the deletion test on a hypothetical `compose()` module: removing it would re-distribute the wiring across two files. Two is more than one, but at v0.1's three-module graph, the cost of the duplication is small — adding a new top-level module is a parallel edit in two files of ~30 and ~50 lines. A `compose()` module would *move* the wiring rather than concentrate complexity that's reappearing across many callers. That fails the deletion test in the direction the team has consistently rejected (ADR-0006 on `contracts.ts`, ADR-0007 on the cause union, ADR-0008's "future grouping urge" warning).

The leverage `compose()` would unlock — single-edit module additions, an incidentally-testable wiring graph — is real but small relative to its cost: a new module to triangulate when reading the code cold, and a shape (`Leaves`) that callers must understand before they can call `compose`. At v0.1, a reader can scan `server.ts` and immediately see the whole composition; a `compose(leaves)` call hides it behind one more hop.

This decision is recorded — rather than left implicit — because future architecture reviews (including this skill, run again in three months) will re-suggest the same extraction. The reasoning here is the kind a future explorer needs to avoid re-litigating.

## Trip-wire conditions for re-opening

Re-open this decision when **either** of the following becomes true:

1. **A third leaf-shape is required.** Today there are two: production (real R2, real db, real template, real `publicDir`) and test (fake R2, `:memory:`, stub template, `null` publicDir). If a third callsite arrives — dev with hot-reload, a CI smoke harness, a deploy preview, a benchmark runner — and it diverges from both shapes, the duplication cost crosses three callsites and the leverage flips. Two parallel edits is tolerable; three is not.

2. **The wiring graph exceeds ~5 top-level constructors.** Today it's three (`createRecordings`, `createUrls`, `createViewerPage`) plus `createApp`. If v0.4 adds an account store, an event publisher, a session middleware, and a metrics collector, the graph reaches the size where a structural divergence between `server.ts` and `testApp.ts` becomes likely (someone forgets to thread a new dep into `testApp.ts` and a test silently keeps using a stale fake). At that point, concentration starts paying for itself.

Either trigger should also surface a different failure mode: today's wiring is *untested* — production verifies it on every boot, but no test exercises `server.ts`'s constructor sequence directly. The skill's exploration flagged this. Today the failure mode is contained because the wiring is small and obvious; once either trip-wire fires, the absence of a wiring test becomes a real risk and `compose()` is the natural place to add one.

## Considered Options

- **Extract `compose({ leaves })` now.** Rejected for the deletion-test reason above. Same shape error as the rejected options in ADR-0006 / ADR-0007 — extracting a seam before the leverage exists.
- **Add a wiring smoke test against `server.ts` directly** (without extracting `compose`). Considered. Worth doing only once an integration surface exists that doesn't rely on `testApp.ts`. Until then, `tests/helpers/testApp.ts` is itself the wiring test — every server-side test boots through it.
- **Document the duplication in a comment in `testApp.ts` pointing at `server.ts`.** Rejected as redundant once this ADR exists; the ADR is the durable form of the same warning.

## Consequences

- `server.ts` and `testApp.ts` continue to be parallel wirings. Module additions before the trip-wire fires require parallel edits.
- Reviewers should not re-suggest extracting `compose()` without checking the trip-wire conditions first. If a review pass is tempted, this ADR is the artefact to consult; if both conditions still test false, leave the duplication.
- When a trip-wire does fire, the extraction is straightforward — both files already follow the same construction order, and `Leaves` is a near-mechanical projection of `RecordingsDeps` ∪ `AppDeps`'s varying fields. The deferral does not make the eventual extraction harder.
