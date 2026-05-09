# Fold `db.ts` into the Recording module

The Recording module (`app/src/recording.ts`) opens its own SQLite handle and owns the schema, prepared statements, and SQLite-specific error mapping internally. The standalone `app/src/db.ts` module and its `DB` interface have been removed. `createRecordings({ dbPath, r2, viewerUrl, generateSlug? })` is the new construction signature.

## Why

`db.ts` exposed a `DB` interface with two methods (`insertRecording`, `getRecording`) and exactly one consumer (`recording.ts`). Applying the deletion test, removing the seam concentrated the persistence work next to the slug-retry loop that already lived in the Recording module: schema, prepared statements, and the `SQLITE_CONSTRAINT_PRIMARYKEY → DuplicateSlugError` translation now sit in one place. Locality improved; no caller lost a public type.

The Recording module is the only module CONTEXT.md identifies as owning the row/R2-object mapping. Splitting persistence into a generic `DB` module diluted that ownership in name only — a generic `DB` with one Recordings-shaped consumer is a hypothetical seam, not a real one (one adapter, one consumer).

## Relationship to ADR-0001

ADR-0001 ("Inject `db` and `r2` into the Recording module") is **refined, not contradicted**, by this change. Its load-bearing claim — that the slug-collision retry and orphan-row failure paths must be deterministically testable — survives unchanged. Those tests are driven by the `r2` and `generateSlug` injection points, which is where the failures actually originate. The `db` injection was carried along to satisfy the same testability principle, but now the test's `:memory:` mode is reached via `dbPath: ':memory:'` instead of a swapped DB adapter, which is one fewer layer with the same effect.

The orphan-row test at `tests/recording.test.ts` and the collision-retry tests still construct a `Recordings` against `:memory:` with a failing R2 / a deterministic slug generator and observe the same outcomes.

## Considered Options

- **Keep `db.ts` for the v0.4 accounts table.** Rejected: `accounts` (when it lands) deserves its own module — `accountStore.ts` next to `recording.ts` — not a shared `DB` kitchen sink. The generic-database abstraction would have to grow to cover both, accumulating Recording-specific assumptions. Cheaper to keep each domain module owning its persistence.
- **Two modules: `recording.ts` + a Recordings-specific `recordingStore.ts`.** Rejected: the store's interface would be a thinly-renamed `DB` with one consumer. The deletion test still favours folding.
- **Expose a test-only `seedForTest(row)` method on `Recordings`.** Rejected: pollutes the production interface with a test seam. Tests that need a known slug now use `generateSlug: () => 'abc123'` and call `recordings.create(...)` — exercising the real path.

## Consequences

- `Recordings` gains a `close()` method (was on `DB`); `server.ts` and tests call `recordings.close()` instead of `db.close()`.
- `DuplicateSlugError` is now internal — caught inside the retry loop, never surfaced to callers. `SlugGenerationExhaustedError` remains the public route-error path.
- `RecordingRow` (formerly `Recording` in `db.ts`) is internal. The unqualified name `Recording` is reserved for a future domain entity (CONTEXT.md's conceptual whole) when an authenticated v0.4 caller needs one.
- `db.test.ts` was removed. Its three cases (round-trip, missing-slug returns null, duplicate raises an error) are covered through `recording.test.ts` — the slug-collision-retry test exercises the `SQLITE_CONSTRAINT_PRIMARYKEY → DuplicateSlugError → retry` chain end to end.
- Test fixtures that previously pre-inserted rows via `db.insertRecording` now use `generateSlug: () => 'known-slug'` + `recordings.create(...)`. Tests are closer to the real path; less knowledge of the persistence schema leaks into the test layer.
