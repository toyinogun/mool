# Extract `urls.ts`; the Recording module does not know `publicAppUrl`

The Express route template for the Viewer page (`/v/:slug`) and the absolute Viewer URL builder (`${publicAppUrl}/v/${slug}`) live together in `app/src/urls.ts`. The Recording module receives `viewerUrl: (slug) => string` as a dependency; it no longer takes `publicAppUrl` and no longer constructs Viewer URLs itself.

## Why

The two halves of the Viewer URL contract — the path that `app.ts` mounts and the URL the Recording module returns to clients — were duplicated across `app.ts` and `recording.ts`. Renaming one without the other would silently produce a Viewer URL pointing at a 404, with no test failure. `urls.ts` is the single owner of both halves; `tests/urls.test.ts` includes a round-trip test that derives a regex from `VIEWER_ROUTE`, matches it against the path of `viewerUrl(slug)`, and asserts the slug is recoverable. That's the test that fails the day someone changes one half without the other.

The second motivation: the Recording module had no business knowing about Mool's public app URL. Its job is Recordings — slugs, R2 keys, the orphan-row contract. URL composition is a presentation concern. Stripping `publicAppUrl` from `RecordingsDeps` narrows the module's interface to what it actually owns, and makes the dependency on a Mool-served URL explicit (callers must pass in a `viewerUrl` function — they can no longer accidentally rely on the Recording module knowing where Mool is hosted).

## Considered Options

- **Leave the duplication, rely on review discipline.** Rejected: the friction is small today (two sites) but multiplies linearly with each new route added at v0.4 (account dashboard, recording list, embeds). Cheaper to pin the contract once than to remember the rule N times.
- **Inject the entire `Urls` object into the Recording module.** Rejected: Recording only needs `viewerUrl(slug)`. Passing the whole bundle widens its interface unnecessarily — same anti-pattern as taking `publicAppUrl`, just hidden behind a richer type.
- **Inject `viewerRoute` through `AppDeps` for symmetry with `recordings`.** Rejected: `AppDeps` is the seam for things that vary between prod and tests (the db, the R2 fake). A route template is a constant — it never has runtime state, never gets overridden in tests. Mixing constants in dilutes what `AppDeps` is for. `app.ts` imports `VIEWER_ROUTE` directly.

## Consequences

`urls.ts` is now the single place to look for "what URL/route shapes does Mool expose for Recordings." When v0.4 adds account-aware paths or v0.5 adds a thumbnail URL, they go here. The Recording module's interface is narrower; it composes `{ slug, uploadUrl, viewerUrl }` from three independent sources (slug generator, R2 mint, urls.viewerUrl) without knowing where any of them live. Adding a fourth URL — say, an embed URL at v0.4 — is a single-file change in `urls.ts` plus a new dep in `RecordingsDeps`.
