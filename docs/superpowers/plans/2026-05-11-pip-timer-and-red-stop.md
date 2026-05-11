# PiP timer and red stop button — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a live `MM:SS` timer between the camera circle and the Stop button inside Mool's existing Document PiP, and recolor the Stop button from green to red.

**Architecture:** Three tasks landed as three commits. Task 1 widens `openFloatingCam`'s signature with a new `startedAt` argument and wires the call site in `recorder.js` to pass `timerStartedAt` — no visible change yet. Task 2 uses that argument to render and tick the timer inside the PiP window and bumps the window's default height to fit it. Task 3 swaps the Stop button's inlined CSS from GitHub-green to GitHub-red. Each task is independently shippable and reviewable.

**Tech Stack:** JSDoc-typed JS modules served as static files (no bundler — see [ADR 0012](../../adr/0012-client-modules-jsdoc-typed-js-no-bundler.md)). TypeScript via `tsc --noEmit` for type-checking. Vitest for unit tests (used elsewhere in the codebase; not used for this module per the spec's §7). Document Picture-in-Picture API in Chromium browsers only.

**Spec:** [`docs/superpowers/specs/2026-05-11-pip-timer-and-red-stop-design.md`](../specs/2026-05-11-pip-timer-and-red-stop-design.md)

---

## Pre-flight

- [ ] **Step 0a: Create a feature branch**

```bash
cd /home/toyin/mool
git checkout -b feat/pip-timer
```

- [ ] **Step 0b: Verify clean starting state**

```bash
cd /home/toyin/mool/app && npm run typecheck && npm test
```

Expected: typecheck passes, all vitest tests pass. (Establishes baseline so any breakage during the plan is attributable to this work.)

---

## Task 1: Add the `startedAt` parameter (passthrough)

Widen `openFloatingCam`'s signature to accept a `startedAt: number` argument and wire the existing call site in `recorder.js` to pass `timerStartedAt`. The argument is received but unused — no behavior change yet. This isolates the type-system change from the rendering change.

**Files:**
- Modify: `app/src/public/recorderFloatingCam.js:42-64` (JSDoc + signature)
- Modify: `app/src/public/recorder.js:168-181` (call site)

### Steps

- [ ] **Step 1.1: Add `startedAt` to the JSDoc and the destructured signature**

In `app/src/public/recorderFloatingCam.js`, find the JSDoc typedef block on the `openFloatingCam` function (currently around lines 42–64) and the function declaration that follows it. Update the JSDoc to declare a new required argument, and add it to the destructured parameter list.

Replace the existing JSDoc + signature block:

```js
/**
 * Open the floating-camera overlay. Returns an opaque handle synchronously;
 * the bubble appears asynchronously. Throws synchronously only if the API
 * is missing — guard with `isFloatingCamSupported()` to avoid this path.
 *
 * @param {{
 *   cameraStream: MediaStream,
 *   onStopClicked: () => void,
 *   onClosed?: () => void,
 *   onError?: (err: unknown) => void,
 *   width?: number,
 *   height?: number,
 * }} args
 * @returns {FloatingCamHandle}
 */
export function openFloatingCam({
  cameraStream,
  onStopClicked,
  onClosed,
  onError,
  width = 240,
  height = 280,
}) {
```

with:

```js
/**
 * Open the floating-camera overlay. Returns an opaque handle synchronously;
 * the bubble appears asynchronously. Throws synchronously only if the API
 * is missing — guard with `isFloatingCamSupported()` to avoid this path.
 *
 * `startedAt` is the `Date.now()` reading at which the recording began. The
 * PiP window runs its own 1Hz interval and renders `Date.now() - startedAt`
 * into a timer element. There is one clock (owned by `recorder.js`) and two
 * displays.
 *
 * @param {{
 *   cameraStream: MediaStream,
 *   onStopClicked: () => void,
 *   startedAt: number,
 *   onClosed?: () => void,
 *   onError?: (err: unknown) => void,
 *   width?: number,
 *   height?: number,
 * }} args
 * @returns {FloatingCamHandle}
 */
export function openFloatingCam({
  cameraStream,
  onStopClicked,
  startedAt,
  onClosed,
  onError,
  width = 240,
  height = 280,
}) {
```

- [ ] **Step 1.2: Pass `startedAt: timerStartedAt` at the call site**

In `app/src/public/recorder.js`, find the existing `openFloatingCam({...})` call (around line 168). Add the new argument. `timerStartedAt` is already declared as a module-local on line 81 and assigned by `startTimer()` on line 97 *before* the call site runs (`startTimer` is invoked from the `Capturing` state's `entry` action; `openFloatingCam` is invoked from the same effect block right after `capture.start`).

Replace:

```js
          const handle = openFloatingCam({
            cameraStream,
            onStopClicked: () => dispatch({ type: 'StopClicked' }),
            onClosed: () => {
```

with:

```js
          const handle = openFloatingCam({
            cameraStream,
            onStopClicked: () => dispatch({ type: 'StopClicked' }),
            startedAt: timerStartedAt,
            onClosed: () => {
```

- [ ] **Step 1.3: Type-check**

```bash
cd /home/toyin/mool/app && npm run typecheck
```

Expected: passes with no errors. (If `timerStartedAt` is somehow out of scope at the call site, the typecheck will surface it.)

- [ ] **Step 1.4: Run the existing test suite to verify no regression**

```bash
cd /home/toyin/mool/app && npm test
```

Expected: all tests pass — same set as the baseline in Step 0b. None of them touch `recorderFloatingCam`, so this is a sanity check that the type widening didn't break a consumer that imports the module type.

- [ ] **Step 1.5: Commit**

```bash
cd /home/toyin/mool
git add app/src/public/recorderFloatingCam.js app/src/public/recorder.js
git commit -m "$(cat <<'EOF'
refactor(recorderFloatingCam): accept startedAt arg (unused for now)

Widens the openFloatingCam signature with a required startedAt: number
parameter and wires recorder.js to pass timerStartedAt. No behavior
change yet — the next commit renders the timer that consumes this.

Refs spec/2026-05-11-pip-timer-and-red-stop-design.md
EOF
)"
```

---

## Task 2: Render and tick the timer in the PiP

Add the `<div class="cam-timer">` between the video and the Stop button, style it via the inlined `<style>`, run a 1Hz `setInterval` inside the PiP window that updates it from `Date.now() - startedAt`, and clear the interval on close (both `close()` and `pagehide` paths). Bump the default `height` from 280 to 320 to fit the timer line without crowding.

**Files:**
- Modify: `app/src/public/recorderFloatingCam.js` (populate function, close function, default height)

### Steps

- [ ] **Step 2.1: Add a module-local `formatElapsed` helper**

Inside `app/src/public/recorderFloatingCam.js`, add this helper near the top of the module (after the `isFloatingCamSupported` export, before `openFloatingCam`). Duplicated from `recorder.js:213-218` on purpose — see spec §4 ("Why duplicate `formatElapsed`").

```js
/**
 * MM:SS format, two-digit padded, no hour rollover. Duplicated from
 * recorder.js (see spec §4): pulling it across the module boundary would
 * require either exporting a recorder-page helper or moving it to a shared
 * module — larger refactors than four lines of trivial logic justify.
 *
 * @param {number} ms
 */
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
```

- [ ] **Step 2.2: Add CSS rules for `.cam-timer` to the inlined `<style>`**

In `populate(win)` (around line 119), find the `style.textContent = \`...\`` template literal. Inside that template, add `.cam-timer` rules between the existing `.cam-preview` block and the `button.primary` block.

Replace:

```js
      .cam-preview {
        width: 200px;
        height: 200px;
        border-radius: 50%;
        object-fit: cover;
        background: #000;
        border: 2px solid #30363d;
        transform: scaleX(-1);
      }
      button.primary {
```

with:

```js
      .cam-preview {
        width: 200px;
        height: 200px;
        border-radius: 50%;
        object-fit: cover;
        background: #000;
        border: 2px solid #30363d;
        transform: scaleX(-1);
      }
      .cam-timer {
        font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
        font-size: 18px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        color: #e6edf3;
      }
      button.primary {
```

- [ ] **Step 2.3: Append the timer `<div>` between the video and the Stop button**

Still in `populate(win)`, after the video is appended to the body (around line 165) and before the Stop button is created (around line 167). The element is created in the PiP window's own document context (`doc.createElement`, not the main page's).

Insert this block between the existing `doc.body.appendChild(video);` line and the `// Stop button.` comment:

```js
    // Live recording timer. 1Hz interval inside the PiP window itself, so the
    // PiP owns its own ticking and the recorder.js module doesn't reach in.
    const timerEl = doc.createElement('div');
    timerEl.className = 'cam-timer';
    timerEl.textContent = formatElapsed(Date.now() - startedAt);
    doc.body.appendChild(timerEl);

    timerInterval = win.setInterval(() => {
      timerEl.textContent = formatElapsed(Date.now() - startedAt);
    }, 1000);
```

- [ ] **Step 2.4: Add a `timerInterval` closure-local and clear it on close**

Near the top of `openFloatingCam` (right after `let video = null;` on the existing `let pipWindow = null;` / `let video = null;` lines), add:

```js
  /** @type {ReturnType<typeof setInterval> | null} */
  let timerInterval = null;
```

Then in the existing `close()` function (around line 194), clear the interval **before** closing the window. The PiP's `setInterval` is bound to the PiP window's own event loop; closing the window destroys it, but explicitly clearing first is cheap and avoids a momentary leaked-handle reading in devtools.

Replace:

```js
  function close() {
    if (closeRequested) return;
    closeRequested = true;
    if (pipWindow) {
      try { if (video) video.srcObject = null; } catch { /* doc may be torn down */ }
      try { pipWindow.close(); } catch { /* idempotent */ }
    }
    // If pipWindow is still null, the IIFE will see closeRequested and dispose
    // the window the moment it arrives.
  }
```

with:

```js
  function close() {
    if (closeRequested) return;
    closeRequested = true;
    if (timerInterval !== null && pipWindow) {
      try { pipWindow.clearInterval(timerInterval); } catch { /* doc may be torn down */ }
      timerInterval = null;
    }
    if (pipWindow) {
      try { if (video) video.srcObject = null; } catch { /* doc may be torn down */ }
      try { pipWindow.close(); } catch { /* idempotent */ }
    }
    // If pipWindow is still null, the IIFE will see closeRequested and dispose
    // the window the moment it arrives.
  }
```

- [ ] **Step 2.5: Also clear the interval on `pagehide` (defense in depth)**

In the existing `win.addEventListener('pagehide', ...)` block (around line 184), clear the interval as the first action inside the listener — fires whether or not `close()` was the cause.

Replace:

```js
    // Manual-close detection. closeRequested is set by `close()` below, so
    // pagehide caused by our own close() does NOT fire onClosed.
    let closedFired = false;
    win.addEventListener('pagehide', () => {
      if (closeRequested) return;
      if (closedFired) return;
      closedFired = true;
      if (onClosed) {
        try { onClosed(); } catch (err) { console.error('openFloatingCam: onClosed threw', err); }
      }
    });
```

with:

```js
    // Manual-close detection. closeRequested is set by `close()` below, so
    // pagehide caused by our own close() does NOT fire onClosed.
    let closedFired = false;
    win.addEventListener('pagehide', () => {
      if (timerInterval !== null) {
        try { win.clearInterval(timerInterval); } catch { /* doc may be torn down */ }
        timerInterval = null;
      }
      if (closeRequested) return;
      if (closedFired) return;
      closedFired = true;
      if (onClosed) {
        try { onClosed(); } catch (err) { console.error('openFloatingCam: onClosed threw', err); }
      }
    });
```

- [ ] **Step 2.6: Bump default `height` from 280 to 320**

In the function signature (modified in Task 1, around line 64), change the default:

Replace:

```js
  height = 280,
```

with:

```js
  height = 320,
```

- [ ] **Step 2.7: Type-check**

```bash
cd /home/toyin/mool/app && npm run typecheck
```

Expected: passes. The `ReturnType<typeof setInterval>` pattern matches what `recorder.js:79` already uses for the same kind of handle, so the typecheck has prior art to follow.

- [ ] **Step 2.8: Run the test suite**

```bash
cd /home/toyin/mool/app && npm test
```

Expected: all tests pass. None touch `recorderFloatingCam`.

- [ ] **Step 2.9: Manual smoke test — timer ticks**

Start the dev server, open the recorder page in Chromium with the camera toggle on, click Start, and observe the PiP window.

```bash
cd /home/toyin/mool && docker-compose up -d
# then open the recorder URL from the README in Chrome
```

Verify by direct observation:

- The PiP window opens with the camera circle, a `00:00` timer below it, and the (still green for now) Stop button below the timer.
- After ~5 seconds the timer reads `00:05`, give or take 1s, matching the in-page timer on the Mool tab.
- Click Stop on the Mool tab. The PiP closes. The browser's devtools console shows no errors and no "Interval handle leaked" style warnings.
- Click Stop inside the PiP for a second recording. The PiP closes. No console errors.
- Start a third recording and manually close the PiP via its X button. Recording continues. No console errors.

If any check fails, stop and debug before committing.

- [ ] **Step 2.10: Commit**

```bash
cd /home/toyin/mool
git add app/src/public/recorderFloatingCam.js
git commit -m "$(cat <<'EOF'
feat(recorderFloatingCam): render live MM:SS timer in PiP

Adds a .cam-timer div between the camera <video> and the Stop button,
driven by a 1Hz setInterval inside the PiP window that reads
Date.now() - startedAt. The interval is cleared both in close() and on
pagehide. Default window height grows from 280 to 320 to fit the new
line without crowding.

formatElapsed is duplicated from recorder.js by design — see spec §4.

Closes the timer half of spec/2026-05-11-pip-timer-and-red-stop-design.md
EOF
)"
```

---

## Task 3: Recolor the Stop button red

Swap the inlined `button.primary` rules from GitHub-green (`#2da44e` / `#2c974b` hover) to GitHub-red (`#da3633` / `#cf2c2c` hover). Background, border, and hover all move together. Text stays `Stop`.

**Files:**
- Modify: `app/src/public/recorderFloatingCam.js` (inlined `<style>` block)

### Steps

- [ ] **Step 3.1: Replace the `button.primary` rules**

In the inlined `<style>` block in `populate(win)`:

Replace:

```js
      button.primary {
        padding: 0.5rem 1.25rem;
        font-size: 0.95rem;
        border-radius: 6px;
        border: 1px solid #2da44e;
        background: #2da44e;
        color: #e6edf3;
        cursor: pointer;
        font-family: inherit;
      }
      button.primary:hover { background: #2c974b; }
```

with:

```js
      button.primary {
        padding: 0.5rem 1.25rem;
        font-size: 0.95rem;
        border-radius: 6px;
        border: 1px solid #da3633;
        background: #da3633;
        color: #ffffff;
        cursor: pointer;
        font-family: inherit;
      }
      button.primary:hover { background: #cf2c2c; }
```

(Text color firms to pure `#ffffff` for crisper contrast against the saturated red. `#e6edf3` reads slightly washed.)

- [ ] **Step 3.2: Type-check**

```bash
cd /home/toyin/mool/app && npm run typecheck
```

Expected: passes.

- [ ] **Step 3.3: Manual smoke test — button is red, hover darkens**

Start a recording in Chromium with camera on:

- The Stop button inside the PiP is filled red (`#da3633`).
- Hovering darkens it to `#cf2c2c`.
- Button text still reads `Stop`.
- Clicking it still stops the recording (no regression).

- [ ] **Step 3.4: Commit**

```bash
cd /home/toyin/mool
git add app/src/public/recorderFloatingCam.js
git commit -m "$(cat <<'EOF'
feat(recorderFloatingCam): recolor PiP Stop button red

Background and border move from #2da44e (GitHub-green) to #da3633
(GitHub-red); hover from #2c974b to #cf2c2c. Text firms to pure #ffffff
for contrast against the saturated red. Aligns the visual semantics
with the action — green read as a start affordance.

Closes the stop-color half of spec/2026-05-11-pip-timer-and-red-stop-design.md
EOF
)"
```

---

## Task 4: Full regression checklist

Run the spec's §7 manual test plan front-to-back, on the branch's final state, before opening the PR. This is the safety net for any interactions between the three commits.

### Steps

- [ ] **Step 4.1: Start a clean dev environment**

```bash
cd /home/toyin/mool && docker-compose up -d
```

- [ ] **Step 4.2: Walk through every checklist item from spec §7**

In a Chromium browser, with the dev tools Console panel open:

- [ ] Start a camera-on recording. The PiP opens with the camera and a `00:00` timer.
- [ ] After ~5 seconds, the PiP timer reads `00:05`, matching the in-page timer within ±1s.
- [ ] Recording continues for 1 minute. PiP timer reads `01:00`.
- [ ] Click Stop *inside the PiP*. PiP closes, recording stops, share link appears on the Mool tab.
- [ ] Start a new camera-on recording. Click Stop on the *Mool tab* instead. PiP closes, no console errors.
- [ ] Start a recording, manually close the PiP via its X button. Recording continues. No console errors; no devtools warning about a leaked interval.
- [ ] Stop button background is `#da3633` (red), hovers to `#cf2c2c`. Stop button text is still `Stop`.
- [ ] Camera-off recording. No PiP. No console errors. (Regression check.)
- [ ] In Firefox (no Document PiP): camera-on recording shows the in-page note, no PiP appears, no console errors. (Regression check.)

- [ ] **Step 4.3: Open a PR if all checks pass**

```bash
cd /home/toyin/mool
git push -u origin feat/pip-timer
gh pr create --title "feat(recorderFloatingCam): timer + red stop in PiP" --body "$(cat <<'EOF'
## Summary
- Adds a live MM:SS timer between the camera and the Stop button inside the existing Document PiP.
- Recolors the Stop button from green to red so its color matches its semantics.
- Bumps the PiP window's default height from 280 to 320 to fit the timer line.

Spec: [`2026-05-11-pip-timer-and-red-stop-design.md`](docs/superpowers/specs/2026-05-11-pip-timer-and-red-stop-design.md)
Plan: [`2026-05-11-pip-timer-and-red-stop.md`](docs/superpowers/plans/2026-05-11-pip-timer-and-red-stop.md)

## Test plan
- [x] `npm run typecheck` passes
- [x] `npm test` passes
- [x] Full manual checklist from spec §7 walked through on Chromium and Firefox (see plan Task 4.2)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Notes for the executing agent

- **No vitest tests for `recorderFloatingCam.js`.** Per the spec (§7) and the module's own file-level docstring, this module is intentionally untested — it is the only place that touches `window.documentPictureInPicture` or builds the PiP's DOM, and its testable seams live in the modules it composes with. Manual smoke tests inside each task are the verification path.
- **Why three commits, not one.** Each commit is independently shippable: Task 1 is a no-op refactor (type widens, behavior unchanged); Task 2 is the timer rendering; Task 3 is the color swap. If review surfaces a problem with one, the others don't need to be revisited.
- **Browser requirement.** Manual checks need a Chromium-family browser (Chrome, Edge, Brave) for the PiP path, and Firefox for the regression-check that the in-page note still surfaces.
- **`pipWindow.clearInterval` vs global `clearInterval`.** Always use the PiP window's own `clearInterval` to match the `setInterval` that created the handle. Mixing event loops (calling main-page `clearInterval` on a PiP-window interval handle) is undefined behavior in practice and silently leaks the timer.
