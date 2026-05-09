# Pin `Recordings.create`'s error contract on the interface

`Recordings.create` declares its three failure modes on its interface — `UnsupportedContentTypeError`, `SlugGenerationExhaustedError`, and the new `UploadMintFailedError` — via a typed JSDoc throw set and exported error classes. The orphan-row contract (the row stays after `mintUploadUrl` fails) is documented on `UploadMintFailedError`'s class and on `create`'s JSDoc. The `/create-upload` route catches `UploadMintFailedError` and returns `502 upload_mint_failed` instead of falling through to the global `500 internal_server_error`.

## Why

The orphan-row contract is load-bearing — ADR-0001 and ADR-0002 both anchor on it, and `tests/recording.test.ts` exercises it — but it was previously visible only in inline comments at `recording.ts:185–193` and across two ADRs. A reader of `Recordings.create` learned its return type was `Promise<CreatedRecording>` and nothing else; the three error paths and the deliberate non-rollback had to be triangulated from comments + tests + ADR-0001 + ADR-0002. The interface was shallower than the contract.

Naming the orphan-mint case as a public error class concentrates the contract at the seam where callers consume it. The route's catch block at `routes/createUpload.ts:62–75` stops being a list of "errors we know about" and becomes an exhaustive translation from domain errors to wire codes — a v0.4 `ForbiddenError` (when accounts arrive) lands at the same seam without re-discovering the pattern.

The `502` change is a separate small win the deepening enables. Previously, R2-side mint failures returned `500 internal_server_error` — the same code as a programming bug in the route. Pinning a different status makes the failure category visible to clients (retryable; not our bug) and to operators (a 502 spike means R2, a 500 spike means us). Today they collide.

## Relationship to ADR-0001, ADR-0002, ADR-0007

ADR-0001's load-bearing claim — that the orphan-row case must be deterministically testable — survives unchanged. The test at `tests/recording.test.ts` keeps its scenario (a failing `mintUploadUrl` after the row is inserted) and gains a stronger assertion: the rejection is an `UploadMintFailedError` carrying the orphaned slug.

ADR-0002's "row records where its bytes live" decision is what makes the orphaned slug recoverable — `UploadMintFailedError.slug` is the handle a future v0.4 sweeper would use.

ADR-0007 considered a tagged cause union for `recorderUpload.js` reasons and rejected it because no caller branched on cause. That rejection is **respected here** — we are not introducing a discriminated cause structure on errors. We are giving each existing failure mode a public name. The route already branches on `UnsupportedContentTypeError`; adding `UploadMintFailedError` to the same shape is an extension of the existing pattern, not a new abstraction.

## Considered Options

- **Result-typed return: `create` returns `{ ok: true, ... } | { ok: false, error: '...' }` and never throws domain errors.** Rejected: forces every caller to `switch` on the discriminant even when most paths are happy-path-or-bubble. The route already has the right shape today (catch the one thing it can translate, let the rest bubble to the global handler) — Result types would invert that without leverage. Result types are catchier for outcomes you expect (parser results, HTTP responses); throw sets are catchier for exceptional paths.
- **Keep the contract implicit; rely on comments + ADR-0001/0002.** Rejected: the contract is already cited in two ADRs, which is the signal that the implicit form is paying ongoing cost (every reader has to re-derive it). Naming the case once at the interface ends the triangulation.
- **Add the named error but keep the route's `500` response.** Rejected partially — the named-error half stands on its own — but conflating R2 outages with internal bugs makes operational triage harder, and the cost of the split (one extra branch in the catch block) is trivial. Worth doing both at once.

## Consequences

- `recording.ts` exports `UploadMintFailedError`. Its constructor takes `{ slug, cause }` so the orphaned slug is recoverable from the error itself — useful for logging and a future sweeper.
- `routes/createUpload.ts` adds one branch: `UploadMintFailedError → 502 { error: 'upload_mint_failed' }`. The wire-error union (`CreateUploadErrorCode`) gains `'upload_mint_failed'`.
- `tests/recording.test.ts`'s orphan-row case asserts `await expect(...).rejects.toBeInstanceOf(UploadMintFailedError)` and inspects `.slug`. The "row stays" assertion is unchanged.
- `tests/createUpload.test.ts` gains a case for the 502 path — a `mintUploadUrl` that throws, asserting the response is `502` with `error: 'upload_mint_failed'`.
- **Future extension**: when v0.4 adds accounts and `recordings.get` / `recordings.create` need a `ForbiddenError`, follow this shape — named error class, JSDoc throw on the interface, route translates to the appropriate wire code. Don't reach for a Result type; the throw set scales fine to four or five public errors.
