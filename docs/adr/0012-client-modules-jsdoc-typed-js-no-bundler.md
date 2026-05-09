# Client modules use JSDoc-typed `.js`, not `.ts`; no bundler in v0.1

The Recorder page's modules under `app/src/public/` (`recorder.js`, `recorderFlow.js`, `recorderCapture.js`, `recorderUpload.js`) are JavaScript with JSDoc annotations, not TypeScript. The browser loads them directly via `<script type="module">`. There is no bundler, no per-file TS→JS compile, no source map. The server side (`app/src/*.ts`, `app/src/routes/*.ts`) is TypeScript, compiled by `tsc` into the Docker image.

The JSDoc annotations on the client modules are **documentation and IDE hints, not compile-time enforced**. `tsconfig.json` does not set `allowJs` or `checkJs`, and the files do not carry `@ts-check`. Cross-tier _value_ consistency (e.g. `ALLOWED_MIME` ↔ `pickMimeType`) is pinned at runtime by `tests/contracts.test.ts`. Cross-tier _type_ consistency is author discipline today.

## Why

The Recorder page is one HTML file plus four ES modules (~700 lines total). The browser's native module loader serves them as-is. Adding TypeScript to the client tier would require either a bundler (esbuild, Vite, Rollup) or a per-file `tsc` emit step; both mean a build pipeline in dev (watch mode), in tests (JS tests would have to import compiled output), and in the Docker image (a build stage that produces the served output). That is real operational surface — a watch loop to remember, a `dist/public/` to serve, source maps to wire — for v0.1's four-module client.

JSDoc costs almost nothing today. The annotations are visible to IDEs (VS Code's JS language server surfaces them as hover and autocomplete without a `@ts-check` pragma), and the cross-tier `@typedef {import('../routes/createUpload').CreateUploadResponse}` pattern in `recorderUpload.js` documents the wire contract next to its consumer. The `// @ts-ignore` on the JS-from-TS test import in `tests/recorderFlow.test.ts` is the only friction the choice imposes on the test layer — cheap and visible.

## Considered Options

- **Add a bundler (Vite/esbuild) and use TS everywhere.** Rejected: buys a build step the v0.1 client does not need. The bundler urge returns whenever someone notices the JSDoc typing is uneven across files; this ADR is the reminder that the decision is intentional.
- **Use `tsc` to compile client-side TS to JS without a bundler.** Rejected: still a build step, still a watch loop, still a "where does emitted output live" question. Solves the typing-syntax preference at the cost of operational surface that doesn't exist today.
- **Enable `allowJs` + `checkJs` in `tsconfig.json` to type-check the existing JSDoc.** Considered. Promotes JSDoc from documentation to compile-time enforcement without introducing a build step. Worth doing the day a JSDoc/TS drift causes a real bug; today no such bug has occurred, the contracts test pins the load-bearing value-level invariant, and the change is one tsconfig line. Keep this in pocket as the cheap trip-wire response, before reaching for a bundler.
- **Move client modules under `src/client/`** (with `src/server/` as the counterpart) to make the split explicit. Rejected: the current `src/public/*.js`-vs-`src/*.ts` convention matches Express's static-served convention and is unambiguous. Renaming is churn for no friction.

## Trip-wire conditions for re-opening

Re-open this decision when **any** of the following becomes true:

1. **Type drift causes a real bug** that `allowJs+checkJs` would have caught. Response is the cheap one above — flip the tsconfig flags before reaching for a bundler. Only escalate further if the JSDoc annotations themselves are the friction.
2. **A third tier appears** — a service worker, a browser extension page, a separate "embed" page. Two tiers (server + Recorder page) are manageable with the current pattern; four are not.
3. **A required client dep does not ship as ES modules.** A library published only as CommonJS or UMD forces a build step regardless of typing preference; at that point, TS comes nearly free.
4. **Client module count exceeds ~6.** Today there are four. As the page grows (a v0.4 auth flow, account-dashboard widgets), JSDoc bookkeeping cost rises. The number is not precise; the signal is "I keep forgetting to update a JSDoc typedef when I rename a server type."

## Consequences

- New client modules use `.js` with JSDoc. A PR adding a `.ts` file under `src/public/` should consult this ADR before merging.
- Cross-tier types extend the JSDoc-import pattern from `recorderUpload.js` — the producing TS module is the source of truth; the JS consumer imports its type via `@typedef {import('...').T}`.
- A `// @ts-ignore` on a JS-from-TS test import is acceptable and expected.
- **Future bundler urge**: if a review pass is tempted to "just add Vite for type cleanliness," check the trip-wires first. If none has fired, the next-cheapest step is `allowJs+checkJs` — not a bundler.
