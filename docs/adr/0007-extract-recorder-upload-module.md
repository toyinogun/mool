# Extract `recorderUpload.js`; the Recorder adapter does not own HTTP

The Recorder page's HTTP layer (the `mintUpload` and `putBytes` calls against `/create-upload` and the Upload URL) lives in `app/src/public/recorderUpload.js`. The module exports two pure async functions that take `fetch` as a dependency and return discriminated outcomes (`{ kind: 'ok', ... } | { kind: 'failed', reason }`). `app/src/public/recorder.js` is now the DOM + `MediaRecorder` adapter; its two effect handlers call into the new module and dispatch state-machine events based on `outcome.kind`.

## Why

The Recorder page was the only part of the app where a tested pure module (`recorderFlow.js`) sat next to a completely untested adapter (`recorder.js`). Each of the two HTTP calls had four observable branches — network throw, JSON parse failure, `!res.ok` with a server error code, and the success case — none of which were exercised. The wire round-trip was tested server-side in `tests/createUpload.test.ts`, but the client's translation from `fetch` outcomes into `CreateOk` / `CreateFailed` / `PutOk` / `PutFailed` SM events was unverified. Applying the deletion test: removing `recorderUpload.js` would re-inline both functions into `recorder.js` and erase the new tests; the branches would become untestable again because `recorder.js`'s state lives in module-level closures over the DOM.

The chosen seam is symmetric with the existing `recorderFlow.js` shape: a pure module the adapter calls. The state machine's `Effect` types (`mintUpload`, `putBytes`) named the seam; this change makes it real instead of hypothetical (one production caller + one test consumer = two adapters per LANGUAGE.md's "two adapters = real seam" rule).

Reason strings are preserved verbatim from the previous inline implementation — `'could not reach server'`, `'unreadable response'`, `errBody.error ?? String(res.status)`, `'Upload failed during transfer.'`, `` `Upload to storage failed: HTTP ${res.status}` ``. Tests pin each one. Behaviour the user sees is unchanged.

## Considered Options

- **Leave the HTTP calls inline in `recorder.js`.** Rejected: leaves four untested branches per function and concentrates module-level state, DOM lookups, and network-call logic in one untested file. The friction is small today (v0.1 has a single `/create-upload` path) but doubles when v0.2 adds mic-toggle headers or v0.4 adds auth.
- **Have the new module dispatch SM events directly** instead of returning outcomes. Rejected: couples the HTTP layer to the SM event vocabulary, widening the new module's interface for no leverage. Tests would have to capture dispatched events instead of inspecting return values. Same anti-pattern ADR-0005 caught with the `R2` interface type.
- **Pull `requestDisplayMedia` into the same module.** Rejected: it's a `navigator.mediaDevices` call with different test setup, and its failure modes (`NotAllowedError` etc.) don't have the silent-failure surface a JSON-parse bug does. If a future change wants `getDisplayMedia` testable, prefer a sibling module (`recorderCapture.js`) rather than widening this one — same reasoning as ADR-0005's "domain-named module per cluster, not a generic wrapper."
- **Normalize `reason` to a tagged cause union** (`{ cause: 'network' | 'unreadable' | 'server', code? }`). Rejected: no caller branches on cause today. ADR-0006's reasoning applies — don't pre-structure for retry policies that aren't here. The structured form earns its keep when something actually branches; until then, verbatim strings are the cheapest contract.

## Consequences

- `recorder.js`'s effect handlers shrink to: call new module, branch on `outcome.kind`, dispatch matching event. The `MediaRecorder`/timer/clipboard logic and DOM bindings stay where they are.
- `tests/recorderUpload.test.ts` covers every previously untested branch: success, network throw, unreadable JSON, `!ok` with server code, `!ok` with status fallback, plus request-shape pins (URL, method, headers, body).
- v0.2 (mic) extends `mintUpload` with one additional argument forwarded to the request body, not by widening `recorder.js`. v0.4 (auth) adds a header in the same place. The adapter doesn't change.
- **Future widening urge**: if a future change wants `requestDisplayMedia` or `copyToClipboard` testable, prefer a sibling module rather than adding them to `recorderUpload.js`. Grouping by "things that need testing" is the bag-of-functions anti-pattern from ADR-0005; group by what actually shares invariants.
