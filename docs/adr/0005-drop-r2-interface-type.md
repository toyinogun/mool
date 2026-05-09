# Drop the `R2` interface type; Recording takes function deps directly

The `R2` interface in `app/src/r2.ts` has been removed. `createR2(cfg)` returns an inferred shape. The Recording module's `RecordingsDeps` no longer takes `r2: R2`; it takes `mintUploadUrl` and `publicUrl` as separate function deps. `r2.ts` still exists and still owns AWS SDK + credentials construction.

## Why

The `R2` interface grouped two functions Recording used in unrelated code paths: `mintUploadUrl` only in `create`, `publicUrl` only in `get`. The two share no invariants from Recording's perspective — they happen to both call into R2, but Recording doesn't care. The bag was a grouping convenience, not an abstraction with substance.

Applying the deletion test to the _type_ (not the file): with one adapter (`createR2`) and one consumer (Recording), removing the type concentrates no complexity. Recording's deps signature now reads as the things it actually needs. Tests improved as a side effect — the orphan-row test (ADR-0001's load-bearing case) and the capturing-content-type test no longer have to provide a `publicUrl` stub they never call. Each test stubs only the function whose behavior it's exercising.

The file itself stays because AWS SDK + credentials wiring has to live somewhere outside `server.ts`. The friction was the named type, not the file.

## Relationship to ADR-0001

ADR-0001 ("Inject `db` and `r2` into the Recording module") is **refined, not contradicted**, by this change — the same pattern as ADR-0004's relationship to ADR-0001. Its load-bearing claim — that the slug-collision retry and orphan-row failure paths must be deterministically testable — survives unchanged. The orphan-row test still injects a failing R2 path; what changed is that it injects `mintUploadUrl: async () => { throw }` directly instead of constructing a fake bag with both methods. The seam stayed; its shape narrowed.

## Considered Options

- **Keep the `R2` interface as a grouping.** Rejected: it groups two unrelated functions under a name (`R2`) that suggests a reusable abstraction. There is exactly one production consumer, in two code paths that don't co-vary. The grouping cost is a named abstraction that future readers must investigate; the benefit is one fewer line of code at call sites. Not worth it.
- **Fold AWS SDK construction into Recording (delete `r2.ts` entirely).** Rejected: AWS SDK construction (region, endpoint, credentials, `forcePathStyle`) is a chunk of config-wiring that doesn't belong in either `recording.ts` or `server.ts`. Keeping the file but dropping the type was the smaller change with the same depth gain.
- **Replace `R2` with a Recording-shaped grouping (e.g. `RecordingStorage`).** Rejected for the same reason as keeping `R2`: today there are no shared invariants between the two functions worth grouping. If a future change introduces real shared state (e.g. a connection pool, a quota tracker, batched operations) the grouping can earn its keep then.

## Consequences

- `RecordingsDeps` exposes `mintUploadUrl` and `publicUrl` as top-level fields. Adding a third R2-side capability (e.g. `deleteObject` for a v0.4 cleanup sweeper) is another field — no abstraction to widen.
- `BuildTestAppOpts` exposes the same fields directly. Tests override individual functions instead of constructing a bag.
- `r2.ts` exports `createR2` only; the return shape is inferred. If a caller outside `server.ts` ever needs the type, name it at the call site rather than re-introducing the export.
- **Future grouping urge**: if a future change is tempted to re-introduce an `R2` interface "for grouping," apply the deletion test on the proposed type. If the answer is "it's just a bag," prefer field-level deps. If there are genuine shared invariants, prefer a domain-named module (e.g. `recordingStorage.ts`) that owns the cluster — not a generic `R2` wrapper.
