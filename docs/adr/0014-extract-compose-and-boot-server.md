# Extract `compose()` for wiring; export `bootServer()` from `server.ts` for testable IO

The wiring graph that builds Mool's Express app — `urls`, `recordings`, `viewerPage`, `app` — lives in `app/src/compose.ts` as a single function `compose({ leaves }): { app, recordings }`. Both the production entry point (`server.ts`) and the test harness (`tests/helpers/testApp.ts`) call `compose` with their own resolved leaves. `compose` is filesystem-free; the resolution of leaves from disk + the AWS SDK lives in `bootServer({ config, viewsDir, publicDir })`, exported from `server.ts` so the IO path is exercised by `tests/server.test.ts` without spawning a child process. The production-only side effects (`loadConfig`, `app.listen`, default paths) sit under `if (require.main === module)`.

## Why

ADR-0010 deferred the `compose()` extraction with two trip-wires: a third leaf shape, or a graph exceeding ~5 top-level constructors. The constructor graph reached **five** today (`createR2`, `createUrls`, `createRecordings`, `createViewerPage`, `createApp` — ADR-0010's count of "three plus `createApp`" predated the `createR2` factory growing into the same shape). At the same time, an architecture review surfaced three failure modes the deferred state could not catch:

1. **Wiring drift** between `server.ts` and `tests/helpers/testApp.ts`. Both files independently constructed the same graph; a constructor added to one and forgotten in the other would pass CI and fail at boot.
2. **Filesystem prep failures.** `mkdirSync(dataDir)` and `readFileSync(viewer.html)` had no test surface; a Docker image built without the views directory crashed at startup with no test catching it.
3. **Adapter-mismatch / wiring-order bugs.** TypeScript caught the structural cases, but config-driven shape errors (e.g. a malformed `PUBLIC_APP_URL` producing a Viewer URL pointing at the wrong route) had no end-to-end check against the real wiring.

`compose()` resolves (1) by making the wiring graph a single function with two callers. `bootServer()` resolves (2) by exposing the IO step as a testable handle. The new `tests/server.test.ts` resolves a slice of (3) by running a request through the real wiring with `bootServer`'s leaves.

## Relationship to ADR-0010 and ADR-0011

**ADR-0010** is **resolved**, not contradicted. Its load-bearing claim — that `compose()` should not be extracted until the leverage exists — held until the trip-wire fired. Its "either trigger should also surface a different failure mode: today's wiring is _untested_" is the gap this ADR closes.

**ADR-0011** is **still in force.** Its principle — _the composition root owns "where files live"_ — survives intact. `bootServer` IS the composition root for filesystem ops; `compose` does not call `node:fs`. ADR-0011's specific trip-wire ("extract a `bootstrap(config)` helper only when the count exceeds two") is **not** what fired here — `bootServer` is exported from `server.ts`, not extracted to `bootstrap.ts`. The motivation is testability of the IO seam, not deduplication of filesystem-prep steps. Today's count is still two (`mkdirSync` + `readFileSync`); ADR-0011's `bootstrap.ts` trip-wire remains armed.

## Considered Options

- **Option A (chosen): `compose()` is filesystem-free; `bootServer` lives inside `server.ts`.** Two functions, one new file (`compose.ts`). Tests get a clean handle on both seams without faking `fs`. ADR-0011 stays intact.
- **Option B: `compose()` owns filesystem too — takes a config object, calls `mkdirSync`/`readFileSync`/`createR2` internally.** Rejected: contradicts ADR-0011 for the wrong reason. Tests would need to fake `node:fs` and the AWS SDK; the principle that "the composition root owns IO" gets weakened to satisfy a testing convenience that has a cleaner answer (Option A).
- **Option C: extract a separate `bootstrap.ts` next to `compose.ts`.** Rejected: ADR-0011 explicitly armed the `bootstrap.ts` trip-wire at "count exceeds two filesystem-prep steps." We have two today. Anticipatory abstraction of the kind ADR-0008's "future grouping urge" warned against. If a v0.4 change adds a third filesystem-prep step (an uploads scratch dir, a per-account directory layout, etc.), promote `bootServer`'s body to `bootstrap.ts` then.
- **Test the IO via a child-process spawn instead of exporting `bootServer`.** Rejected: slower, harder to assert on, and obscures the seam. Exporting `bootServer` keeps the test in-process, in vitest, with the same shape as every other test in the suite. The `if (require.main === module)` guard prevents `app.listen` from firing during test imports.

## Consequences

- `app/src/compose.ts` is the single place that decides "how Mool's modules connect." Adding a new top-level module is one parallel edit (the new constructor in `compose`, plus a new field on `ComposeLeaves`) instead of two (`server.ts` + `testApp.ts`).
- `tests/helpers/testApp.ts` shrinks to building fake leaves and calling `compose`. Its responsibility is now "what fakes to use," not "how to wire Mool."
- `bootServer` is the only place in production code that calls `node:fs` or constructs the AWS SDK client. Tests that need to exercise IO failures (`ENOENT`, missing `dataDir`) call `bootServer` directly with a tmpdir.
- `tests/server.test.ts` (new) covers: happy-path boot, auto-creation of `dataDir`, `ENOENT` on missing `viewer.html`, and a real-wiring round-trip (404 on unknown slug). Adds 4 tests; suite total goes from 153 to 157.
- The R2 SDK is constructed with whatever credentials `config.r2` carries. `createR2` is local-only at construction time, so boot tests pass fake credentials and never trigger a network call. If a future test needs to exercise an R2 failure inside the boot path, prefer `compose` directly with a fake `mintUploadUrl` (the existing pattern in `tests/recording.test.ts`) over teaching `bootServer` to take an R2 override.
- **Future grouping urge**: if a future change wants to push more responsibility into `compose` — _e.g._ env loading, a logger, a metrics initializer — apply the deletion test on the proposed addition. `compose` earns its keep as a wiring graph; widening it to "everything Mool starts up" recreates the shape ADR-0011's `bootstrap.ts` trip-wire is reserved for.
