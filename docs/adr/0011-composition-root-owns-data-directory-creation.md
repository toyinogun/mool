# Recording does not `mkdir` its data directory; the composition root owns "where files live"

The Recording module (`app/src/recording.ts`) no longer creates the parent directory of `dbPath` before opening SQLite. The composition root (`server.ts`) calls `mkdirSync(config.dataDir, { recursive: true })` once at boot, then constructs `Recordings` with a path it has already prepared. The `:memory:` special case is gone from `createRecordings` — SQLite recognises the literal natively, so no guard is needed.

## Why

ADR-0008 cited the principle "the composition root owns 'where files live'" when it kept `readFileSync` of the Viewer template in `server.ts` rather than letting `viewerPage.ts` read its own file. Recording was applying the principle inconsistently: it took `dbPath` from the caller (good) but then created the parent directory itself (bad) and special-cased `:memory:` to skip that filesystem call — a knowledge leak, since Recording had to know which path string meant "skip the IO."

The asymmetry was small but real. After this change, every server-side filesystem call lives in `server.ts` (`readFileSync` of the template, `mkdirSync` of the data dir, `path.join` of the db file). Tests do no filesystem work because they use `:memory:`, which SQLite handles without disk access. `createRecordings`'s implicit precondition narrows from "`dbPath` is `:memory:` _or_ its dirname is creatable by us" to "`dbPath` is openable" — which is the contract callers already understood.

## Considered Options

- **Leave the `mkdir` in `createRecordings`**, framing it as "Recording owns its persistence end-to-end." Rejected: the directory is not Recording's; it is the deployment's `DATA_DIR`. The db _file_ is Recording's; its parent is shared — a v0.4 `accountStore.ts` would write to the same directory. Concentrating directory creation at the composition root is symmetric with how every other "where files live" decision is made today.
- **Move the `mkdir` into `loadConfig`** so the config object is "ready to use." Rejected: conflates parsing with filesystem prep, and `loadConfig` has only one production caller (`server.ts`) — no leverage gained. Tests do not call it.
- **Extract a `bootstrap(config)` helper.** Rejected for v0.1: anticipatory abstraction for a one-line `mkdir`. The trip-wire is "more than one filesystem-prep step at boot." Today there is one.

## Relationship to ADR-0008

ADR-0008's principle is **applied symmetrically**, not amended. ADR-0008 kept `readFileSync` in `server.ts` because `viewerPage.ts` should not own filesystem. The same reasoning applies here: `createRecordings` should not own filesystem either. The two decisions now share one shape — the composition root is the only module that calls into `node:fs`.

## Consequences

- `recording.ts` drops imports of `mkdirSync` and `dirname`. The `:memory:` guard is gone.
- `server.ts` adds `mkdirSync(config.dataDir, { recursive: true })` immediately after `loadConfig()`.
- The JSDoc on `RecordingsDeps.dbPath` is unchanged — it still names `:memory:` as the test mode, which is true; what changed is that Recording no longer recognises the literal in its implementation.
- Tests are unchanged. The `:memory:` paths in `tests/recording.test.ts` and `tests/helpers/testApp.ts` keep working through SQLite's native handling.
- **Future filesystem-prep urge**: if v0.4+ adds a second "ensure X exists" step (e.g. an uploads scratch dir), prefer adding it next to the existing `mkdirSync` in `server.ts` rather than pushing it into the consumer module. Extract a `bootstrap(config)` helper only when the count exceeds two — same trip-wire reasoning as ADR-0010 on `compose()`.
