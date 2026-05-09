# Store `r2_key` in SQLite rather than deriving it from the slug

The `recordings` table keeps the `r2_key` column even though, in v0.1, the value is always `<slug>.webm` and could be computed from the slug at read time.

## Why

The R2 key format is expected to change as the product grows — the spec's growth ladder calls out a `recordings/` prefix at v0.5 once thumbnails arrive, and per-Recording variation becomes plausible once accounts (v0.4) and editing features land. If we derive the key from the slug, every format change must apply uniformly to every existing object in R2, forcing a coordinated bulk rename. By storing the key on the row, each Recording records where its bytes actually live, and a format change applies to new Recordings only — old ones stay valid without migration.

## Considered Options

- **Drop the column, derive `r2_key = `${slug}.webm`** in code. Rejected for the migration reason above. Looks redundant today (it is), but the redundancy is what protects existing Recordings during future format changes.

## Consequences

The Recording module is the only place that constructs `r2_key` on insert. Callers never see the column directly — they get presigned upload URLs and viewer URLs back from `create` / `get`. If we ever do want to migrate old keys, the column lets us do it row-by-row instead of all-at-once.
