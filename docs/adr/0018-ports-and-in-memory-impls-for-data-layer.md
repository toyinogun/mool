# Ports and in-memory implementations for the data layer

Both data-layer interfaces (`Recordings` and `AuthStore`) ship with two implementations in the same file: a production Postgres impl and a test in-memory impl.

## Why

v0.1 kept the test suite fast and database-free by pointing `createRecordings` at `:memory:` — SQLite's in-process mode. v0.4 replaces SQLite with Postgres, which has no in-process mode. Without a deliberate substitute, every test would require a live Postgres container, slowing `npm test` from ~1 s to however long container startup takes, and breaking the ergonomic "just `npm test`" loop.

The two ports are:

- **`Recordings`** (extended in v0.4) — a pre-existing interface that the v0.1 SQLite impl satisfied. v0.4 adds `listByUser`, `deleteBySlugForUser`, and `findBySlugForUser`.
- **`AuthStore`** (new in v0.4) — covers users, sessions, and signin tokens. Three conceptually distinct tables, but they're always used together through the auth flow, so a single interface keeps the composition root simple.

## Decision

Each interface has exactly two factories in its implementation file:

- `createPostgresRecordings(db)` — production impl, issues SQL via Drizzle.
- `createInMemoryRecordings()` — test impl, uses a `Map<slug, RecordingRow>` in process memory.

- `createPostgresAuthStore(db)` — production impl.
- `createInMemoryAuthStore()` — test impl, uses `Map`s for users, sessions, and tokens, with expiry enforced in JS.

The composition root (`compose.ts`) selects the impl based on whether a real `db` handle is present (`leaves.db !== null`). Tests call `buildTestApp({ authStore?, recordings? })` which defaults both to their in-memory factories — no env vars, no containers, no teardown.

## Rationale

This preserves the `:memory:` ergonomics of v0.1. `npm test` is a self-contained command that runs in under two seconds. The Postgres impls are verified at production boot via the migrate-on-boot + healthcheck path (and via the smoke test in the cutover checklist). They can be backed by integration tests gated on a `POSTGRES_TEST_URL` env var, but that gate is not mandatory — the unit suite alone provides confidence for the pure-logic paths.

Keeping both impls in the same file (e.g. `recordings.ts`, `authStore.ts`) rather than splitting into `recordings.postgres.ts` / `recordings.memory.ts` is a deliberate choice: it keeps the interface and both impls co-visible, making drift between them easier to spot. If either impl file grows past ~200 lines, split then.

## Consequences

- A subtle bug that exists in only one impl — e.g. case-sensitivity in email lookups, NULL handling in `consumed_at`, or transaction semantics — will be invisible to the test suite.
- Mitigation: keep the impls thin. Most business logic lives in route handlers or shared helpers (`createRecordingCore`), not inside the impl methods. The impl methods do exactly one thing each: a read or a write against their backing store.
- Periodic integration tests against a real Postgres should be added if any real behavioural divergence emerges. Gate them on `process.env.POSTGRES_TEST_URL` so they are opt-in in CI and always skipped in the default `npm test` run.
- The in-memory impls are not exported from `app/src/` — they are imported only by `tests/helpers/testApp.ts` and `tests/helpers/buildAuthStore.ts`. Production code never sees them.
