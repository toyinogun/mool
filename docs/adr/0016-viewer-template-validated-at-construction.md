# Viewer template is validated at construction; one CI smoke test against the production file

`createViewerPage({ template })` validates `template` at construction: every required placeholder must be present, and no unknown `{{IDENT}}` markers may appear. The required-slot list (`['PLAYBACK_URL']` in v0.1) lives in `viewerPage.ts` next to the substitution. A unit test in `viewerPage.test.ts` reads the real `app/src/views/viewer.html` from disk and asserts `createViewerPage` accepts it; this is the only place in the test suite that exercises the production template file.

## Why

ADR-0008 deepened the rendering layer to concentrate the substitution but left the contract direction template → renderer fortified only by a *post-substitution* residue check at `tests/viewerPage.test.ts:36-46`. That check fires only against templates the test passes in (string stubs); the production file at `app/src/views/viewer.html` was unchecked by any test. A typo (`{{PLAYBACL_URL}}`), an HTML-escape bug, or a renamed placeholder would silently no-op — `template.replace(...)` returns the input unchanged when the regex doesn't match — and ship a literal `{{PLAYBACK_URL}}` in the page's `<video src>`. The residue check at `server.test.ts:95-106` only verifies that the file exists, not that its contents are well-formed.

Lifting the validation to construction closes both directions of drift in one place:

- **Renderer expects a slot the template lacks** (rename, typo, HTML-escape) → `missing` is non-empty, `createViewerPage` throws at boot.
- **Template carries a slot the renderer won't fill** (orphaned placeholder from a partially-reverted change, or a v0.5 placeholder added to HTML before the renderer is updated) → `unknown` is non-empty, `createViewerPage` throws at boot.

The CI test against the real file is the load-bearing companion. Without it, the construction-time validation fires only when production boots — which means a bad commit ships, the deploy fails, and rollback is the recovery path. With the test, the typo is caught at PR review.

## Considered Options

- **Validate only required-presence; keep the post-substitution residue check.** Rejected: splits the contract direction across two test sites — construction fires on missing slots, post-substitution fires on unknown ones. Bidirectional check at one site is the same cost (one regex sweep) with one less seam to remember.
- **Validate inside `bootServer` (the composition root) rather than `createViewerPage`.** Rejected: places the slot-name knowledge in two files. ADR-0008 already settled that the rendering layer owns the slot list; validation is part of "owning the slot list."
- **Extract a generic `validateTemplate(template, slots)` helper.** Rejected for v0.1: one template, one consumer, no second template in flight. ADR-0006-style premature grouping. The validation lives in `createViewerPage` until a second template wants the same shape.
- **Data-drive the substitution from `REQUIRED_SLOTS` so the placeholder names appear in only one place.** Rejected for v0.1 — see Trip-wire conditions below.
- **Skip the prod-file CI test; rely on boot-time validation.** Rejected: lets a bad commit pass review and ship to prod before the check fires. The cost of the test is ~5 lines and one `readFileSync`. The leverage is "no broken template ever reaches a deploy."
- **Move the existing post-substitution residue test to a smoke test against the prod file.** Rejected as redundant with the prod-file construction test: if `createViewerPage(realTemplate)` succeeds, the residue check on its output is mathematically guaranteed to pass — the validation enforces the same invariant at the input.

## Relationship to ADR-0008

ADR-0008's load-bearing decision — that template substitution lives in `createViewerPage` rather than distributed across the route, the route test, and a residue regex — is **extended, not amended.** This ADR adds template *validation* to the same module, on the same principle: the rendering layer owns its template's contract.

The hedge ADR-0008 explicitly anticipated ("the day a second placeholder lands at v0.5 (thumbnails) or v0.6 (titles)") becomes cheaper. Adding a slot at v0.5 is `REQUIRED_SLOTS = ['PLAYBACK_URL', 'THUMBNAIL_URL']` plus a substitution call plus a renderer-input field — three sites, all in `viewerPage.ts`, with the validation catching any partial application.

## Trip-wire conditions for re-opening

Re-open this decision (toward data-driven substitution) when **either** becomes true:

1. **A third placeholder lands.** With three slots, the `template.replace(/\{\{X\}\}/g, ...)` call repeats three times in the renderer body — at that point the data-driven loop pays for its TS-mapping cost (mapping `PLACEHOLDER_NAME` → `inputFieldName`, e.g. `PLAYBACK_URL` → `playbackUrl`).

2. **A second template arrives** (e.g. a v0.4 account-dashboard view). Two templates with the same placeholder convention is when `validateTemplate(template, slots)` becomes a real seam (two adapters, two consumers) rather than a hypothetical one. At that point the helper extraction earns its keep.

## Consequences

`viewerPage.ts` grows by ~10 lines for the validation block. The post-substitution residue test at `viewerPage.test.ts:36-46` is removed — it tested an invariant that's now enforced at construction, against an input the construction-time check no longer permits. Three new tests pin the behaviour: missing-slot throws, unknown-slot throws, and the prod-file is accepted.

`tests/server.test.ts:29-30`'s in-repo `TEMPLATE` constant remains as-is — it still functions as a "real wiring with a real fs" smoke test, and its template happens to satisfy the new validation. No change there.
