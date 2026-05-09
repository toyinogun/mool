# Wire shapes owned by the producing route; no central `contracts.ts`

There is no central wire-contracts module. Each route file owns the wire types it produces. `routes/createUpload.ts` defines `CreateUploadResponse`, `CreateUploadErrorCode`, and `CreateUploadErrorResponse` directly. The Recording module returns a domain type (`CreatedRecording`) and the route projects to wire via a small `toWire(...)` helper.

`ALLOWED_MIME` and `AllowedMime` live in `recording.ts`. They are not wire shapes — they are Recording's content-type validation rule, which the frontend recorder happens to also reference.

## Why

The previous `contracts.ts` mixed two unrelated concerns: a domain rule (`ALLOWED_MIME`) and HTTP wire shapes for one endpoint. The wire shapes had exactly one producer (`POST /create-upload`) and the alias chain `Recordings.create` → `CreatedRecording` → `CreateUploadResponse` made the Recording module's return type rename-coupled to the route's wire body. The hedging comment on `CreatedRecording` ("split this when an authenticated v0.4 caller needs more than the wire ships") anticipated the eventual split — but the split is the right shape today, not later.

This is the same reasoning ADR-0003 used for URLs: the Recording module had no business knowing Mool's `publicAppUrl`. Symmetrically, it has no business knowing the wire shape of `POST /create-upload`. Recording produces a Recording. The route serializes.

The projection layer (`toWire`) is identity today and costs ~5 lines. When v0.4's authenticated dashboard wants `createdAt` (or any field that isn't appropriate to leak on the public wire), the projection diverges in one file with no rename-drift across modules.

## Considered Options

- **Keep `contracts.ts` as a wire-shape module; just split `ALLOWED_MIME` out.** Rejected: the wire types still had one producer and one consumer (the route + its test). One adapter is a hypothetical seam. Centralization for its own sake widens the surface a future reader has to triangulate.
- **Recording produces wire shapes directly (no projection).** Rejected: it bakes in the rename-drift the alias was hedging against, and conflates Recording's purpose ("the conceptual entity") with HTTP transport. The cost saved (one `toWire` function) is small; the contract clarified is large.
- **A central `wire/` directory grouped by route.** Rejected for v0.1: there's one route. When v0.4 adds the account dashboard endpoints, _if_ they share shapes, re-extract then. Premature grouping invites the same problem we just left.

## Consequences

- Each new route at v0.4+ owns its wire shapes in its own file. If two routes legitimately share a shape (e.g. an `Account` envelope used by multiple endpoints), promote that shape to a shared module at extraction time, not preemptively.
- The Recording module's interface is wire-agnostic: `create` returns `CreatedRecording`, `get` returns `RecordingView`. Both are domain types defined in `recording.ts`.
- `app.ts`'s global 500 handler emits `{ error: 'internal_server_error' }` inline. It deliberately does not import the route's `CreateUploadErrorResponse` — the global handler is route-agnostic by design, even though today it only fires for the create-upload pipeline.
- `tests/contracts.test.ts` still pins both halves (the `ALLOWED_MIME` value and the wire round-trip), now imported from their new homes. The file name was kept; renaming would be churn for no friction.
- **Future extraction urge**: if you find yourself wanting to centralize wire shapes "for tidiness," apply the deletion test on the proposed module. If the answer is "the shapes have one producer each," prefer leaving them with their producers.
