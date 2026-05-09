# Inject `db` and `r2` into the Recording module

The Recording module (`app/src/recording.ts`) takes `{ db, r2 }` as call-time dependencies rather than importing module-level singletons from `db.ts` and `r2.ts`. Singletons are constructed once in `app.ts` (`createApp(config)`) and threaded into the route mounters.

## Why

We want deterministic tests for two failure paths the v0.1 spec explicitly accepts but never tested: the slug-collision retry loop and the orphan-row case where R2 fails after the SQLite insert. Both are effectively impossible to provoke when `db` and `r2` are module-level singletons — the first because the slug namespace is ~57B, the second because there's no seam to inject an R2 that throws. Injection makes both into one-line tests with fakes. The Recording module is the boundary where the contract ("best-effort, non-atomic creation") needs to be pinned, so it's the right place to require the seam.

## Considered Options

- **Module-level imports** (the obvious idiomatic Node choice). Rejected: leaves the documented failure paths untestable, which makes the "best-effort" contract aspirational rather than verified.
- **Singleton in `r2.ts` only, leave `db` global.** Rejected: half-fixes the orphan test but doesn't help collision retry, and introduces an inconsistency that's harder to remember than just doing both.

## Consequences

Every Recording-module consumer (the route handlers) gets `{ db, r2 }` passed in. `testApp.ts` becomes a parameter swap rather than env-var manipulation. Adding a third external dep later (e.g. a logger, a queue) follows the same pattern.
