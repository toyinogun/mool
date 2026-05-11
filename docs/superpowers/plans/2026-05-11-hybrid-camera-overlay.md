# Hybrid Camera Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Mool's live camera surface react to tab visibility — show the clean in-page bubble while the Mool tab is visible, open the Document PIP bubble while it's hidden — so the user gets Loom-quality polish on the home tab plus cross-tab follow.

**Architecture:** A `visibilitychange` listener registered for the duration of a camera-on recording on Chromium, opening the existing `recorderFloatingCam.js` PIP on `hidden` and closing it on `visible`. All new logic lives in `recorder.js` as a thin reactive wrapper around the unchanged PIP module. Two tasks: a no-behavior-change refactor that extracts the existing inline PIP wiring into named helpers, then the visibility-driven trigger change layered on top.

**Tech Stack:** Vanilla ES modules, JSDoc-typed JS, no bundler ([ADR-0012](../adr/0012-client-modules-jsdoc-typed-js-no-bundler.md)). Vitest for the existing unit tests (no new tests in this plan — `recorder.js` is intentionally untested per its file-level docstring; the testable seams are in the modules it composes). Manual smoke testing on Chromium for verification.

**Spec:** [`docs/superpowers/specs/2026-05-11-hybrid-camera-overlay-design.md`](../specs/2026-05-11-hybrid-camera-overlay-design.md)

---

## Task 1: Extract `openFloatingCamIfClosed` and `closeFloatingCamIfOpen` helpers (pure refactor)

This task introduces two named helpers that wrap the floating-cam open/close idioms already inlined three times in `recorder.js` (in `startCapture`, in the `onCameraEnded` callback, and in `releaseStream`). No behavior changes — the recording flow at the end of this task is identical to current `main`. This refactor exists so Task 2 can layer the visibility trigger on top without touching the open/close internals.

**Files:**
- Modify: `app/src/public/recorder.js`

- [ ] **Step 1: Add the two helpers next to `restoreInPagePreview`**

In `app/src/public/recorder.js`, after the existing `restoreInPagePreview()` function (which ends at line 279 in the current file), insert:

```js
/**
 * Open the floating-camera overlay if it isn't already open. No-op if
 * a bubble is already live, if there is no camera stream, or if Document
 * PIP is unsupported. The asynchronous PIP open may still fail later via
 * `onError`; that path nulls the handle and surfaces a status message.
 */
function openFloatingCamIfClosed() {
  if (floatingCamStop) return;
  if (!cameraStream) return;
  if (!floatingCamSupported) return;
  try {
    const handle = openFloatingCam({
      cameraStream,
      onStopClicked: () => dispatch({ type: 'StopClicked' }),
      onClosed: () => {
        floatingCamStop = null;
        restoreInPagePreview();
        ports.setStatus('Floating camera closed — recording continues.');
      },
      onError: () => {
        floatingCamStop = null;
        restoreInPagePreview();
        ports.setStatus('Floating camera unavailable — recording continues without overlay.');
      },
    });
    floatingCamStop = handle.close;
    suspendInPagePreview();
  } catch {
    // Synchronous throw means the API isn't available. The
    // floatingCamSupported guard above should make this unreachable, but
    // if it isn't, leave the in-page preview alone.
    ports.setStatus('Floating camera unavailable — recording continues without overlay.');
  }
}

/**
 * Close the floating-camera overlay if one is open, then restore the
 * in-page preview unconditionally. The unconditional restore matters
 * because a `visible` transition arriving after a manual close would
 * otherwise leave `previewSuspended` true forever — the early-return
 * `restoreInPagePreview()` is itself a no-op when nothing is suspended.
 */
function closeFloatingCamIfOpen() {
  if (floatingCamStop) {
    floatingCamStop();
    floatingCamStop = null;
  }
  restoreInPagePreview();
}
```

- [ ] **Step 2: Replace the inline open block in `startCapture` with a call to the helper**

Find the block in `startCapture` that currently reads (lines 163–190 in the current file):

```js
      // Floating-camera overlay (Document PIP). Skipped on non-Chromium
      // browsers; failures are non-fatal — the recording is the product,
      // the bubble is feedback.
      if (floatingCamSupported) {
        try {
          const handle = openFloatingCam({
            cameraStream,
            onStopClicked: () => dispatch({ type: 'StopClicked' }),
            onClosed: () => {
              floatingCamStop = null;
              restoreInPagePreview();
              ports.setStatus('Floating camera closed — recording continues.');
            },
            onError: () => {
              floatingCamStop = null;
              restoreInPagePreview();
              ports.setStatus('Floating camera unavailable — recording continues without overlay.');
            },
          });
          floatingCamStop = handle.close;
          suspendInPagePreview();
        } catch {
          // Synchronous throw from openFloatingCam means the API isn't
          // available. floatingCamSupported guard above should make this
          // unreachable, but if it isn't, leave the in-page preview alone.
          ports.setStatus('Floating camera unavailable — recording continues without overlay.');
        }
      }
```

Replace with:

```js
      // Floating-camera overlay (Document PIP). The helper is a no-op on
      // non-Chromium browsers; failures are non-fatal — the recording is
      // the product, the bubble is feedback.
      openFloatingCamIfClosed();
```

- [ ] **Step 3: Replace the inline cleanup in the `onCameraEnded` callback**

Find the `onCameraEnded` callback inside `startCapture` (lines 148–155 in the current file):

```js
      composite.onCameraEnded(() => {
        ports.setStatus('Camera disconnected — continuing with screen only.');
        if (floatingCamStop) {
          floatingCamStop();
          floatingCamStop = null;
          restoreInPagePreview();
        }
      });
```

Replace with:

```js
      composite.onCameraEnded(() => {
        ports.setStatus('Camera disconnected — continuing with screen only.');
        closeFloatingCamIfOpen();
      });
```

- [ ] **Step 4: Replace the inline cleanup in `releaseStream`**

Find the `releaseStream` port (lines 125–138 in the current file):

```js
  releaseStream() {
    if (composeStop) {
      composeStop();
      composeStop = null;
    }
    if (floatingCamStop) {
      floatingCamStop();
      floatingCamStop = null;
    }
    // No-op if not suspended (camera-off recording, or bubble already
    // closed via onClosed). Safe in all paths.
    restoreInPagePreview();
    capture.release();
  },
```

Replace with:

```js
  releaseStream() {
    if (composeStop) {
      composeStop();
      composeStop = null;
    }
    closeFloatingCamIfOpen();
    capture.release();
  },
```

- [ ] **Step 5: Run typecheck and the full test suite — they should pass unchanged**

Run from the `app/` directory:

```bash
cd /home/toyin/mool/app && npm run typecheck && npm test
```

Expected: typecheck clean (no errors), all existing vitest tests pass. None of the test files touch `recorder.js`, so the suite should be unaffected.

- [ ] **Step 6: Smoke-test that PIP-only behavior is unchanged**

Start the dev server in one terminal:

```bash
cd /home/toyin/mool/app && npm run dev
```

In Chromium, open `http://localhost:3000`. Run through the existing Chromium happy path:

1. Tick **Camera on**, allow camera access — in-page preview circle appears.
2. Click **Start Recording**, share any tab in the picker — the floating PIP bubble should open immediately, just as on current main.
3. The in-page preview circle should disappear (suspended).
4. Click **Stop** in the bubble — recording ends, share link appears, in-page preview reappears (camera toggle is still on).

If anything diverges from current main behavior, the refactor introduced a regression — fix before committing.

- [ ] **Step 7: Commit**

```bash
cd /home/toyin/mool && git add app/src/public/recorder.js && git commit -m "$(cat <<'EOF'
refactor(recorder): extract openFloatingCamIfClosed and closeFloatingCamIfOpen

Pure refactor with no behavior change. The floating-cam open/close
idioms were inlined three times in recorder.js (startCapture, the
onCameraEnded callback, and releaseStream). Extract them into two named
helpers so the upcoming hybrid visibility trigger can layer on top
without touching the PIP open/close internals.

closeFloatingCamIfOpen restores the in-page preview unconditionally —
the underlying restoreInPagePreview is already a no-op when nothing is
suspended, but the unconditional call matters once visibility-driven
close arrives after a manual close (where preview was restored in
onClosed and the close-on-visible would otherwise be silent).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Wire the `visibilitychange` listener and switch the open trigger to hybrid

This task adds the actual hybrid behavior: register a `visibilitychange` listener for the duration of a camera-on recording on Chromium, open the PIP on `hidden`, close it on `visible`. The PIP open at recording start is gated on `document.hidden` so the in-page bubble is the only camera surface when the user is on the Mool tab.

**Files:**
- Modify: `app/src/public/recorder.js`

- [ ] **Step 1: Add the visibility listener handle next to the other module-locals**

In `app/src/public/recorder.js`, find the existing `floatingCamStop` declaration and the JSDoc above it (lines 65–72 in the current file, or whatever line they're at after Task 1). Immediately after the `let floatingCamStop = null;` line, add:

```js

/**
 * Cancellation handle for the active `visibilitychange` listener. Bound
 * in `setupVisibilityHandling()` (called from `startCapture` when
 * `videoEnabled && cameraStream && floatingCamSupported`), removed in
 * `teardownVisibilityHandling()` (called from `releaseStream`). Null
 * outside an active camera-on recording on Chromium.
 * @type {(() => void) | null}
 */
let visibilityListener = null;
```

- [ ] **Step 2: Add `setupVisibilityHandling` and `teardownVisibilityHandling` helpers**

Insert these two helpers immediately after `closeFloatingCamIfOpen` (added in Task 1):

```js
/**
 * Register a `visibilitychange` listener that opens the floating-cam
 * bubble when the Mool tab becomes hidden and closes it when the tab
 * becomes visible. Idempotent — calling twice without a teardown in
 * between would leak a listener, so callers (just `startCapture`) must
 * pair this with `teardownVisibilityHandling()` in `releaseStream`.
 *
 * The handlers delegate to the same `openFloatingCamIfClosed` and
 * `closeFloatingCamIfOpen` helpers used elsewhere — manual close,
 * visibility-driven close, and recording-end teardown all share one
 * close path.
 */
function setupVisibilityHandling() {
  visibilityListener = () => {
    if (document.hidden) {
      openFloatingCamIfClosed();
    } else {
      closeFloatingCamIfOpen();
    }
  };
  document.addEventListener('visibilitychange', visibilityListener);
}

/**
 * Reverse of `setupVisibilityHandling()`. Idempotent — safe to call when
 * no listener is registered (camera-off recording, or recording on a
 * non-Chromium browser).
 */
function teardownVisibilityHandling() {
  if (visibilityListener) {
    document.removeEventListener('visibilitychange', visibilityListener);
    visibilityListener = null;
  }
}
```

- [ ] **Step 3: Wire `setupVisibilityHandling` into `startCapture` and gate the immediate open on `document.hidden`**

In `startCapture`, find the block added in Task 1 step 2:

```js
      // Floating-camera overlay (Document PIP). The helper is a no-op on
      // non-Chromium browsers; failures are non-fatal — the recording is
      // the product, the bubble is feedback.
      openFloatingCamIfClosed();
```

Replace with:

```js
      // Hybrid floating-camera overlay (Document PIP). On Chromium,
      // register a visibility listener that opens the bubble while the
      // Mool tab is hidden and closes it while the tab is visible. If
      // the user is already on a hidden tab when recording starts (rare
      // — happens when the screen-picker brought them to a different
      // window), open the bubble immediately. On non-Chromium the
      // helper short-circuits and the in-page preview stays as the only
      // camera surface for the whole recording.
      if (floatingCamSupported) {
        setupVisibilityHandling();
        if (document.hidden) {
          openFloatingCamIfClosed();
        }
      }
```

- [ ] **Step 4: Wire `teardownVisibilityHandling` into `releaseStream`**

In the `releaseStream` port (the version produced by Task 1 step 4):

```js
  releaseStream() {
    if (composeStop) {
      composeStop();
      composeStop = null;
    }
    closeFloatingCamIfOpen();
    capture.release();
  },
```

Replace with:

```js
  releaseStream() {
    if (composeStop) {
      composeStop();
      composeStop = null;
    }
    teardownVisibilityHandling();
    closeFloatingCamIfOpen();
    capture.release();
  },
```

- [ ] **Step 5: Update the manual-close status message to reflect hybrid semantics**

In `openFloatingCamIfClosed` (added in Task 1 step 1), find the `onClosed` callback:

```js
      onClosed: () => {
        floatingCamStop = null;
        restoreInPagePreview();
        ports.setStatus('Floating camera closed — recording continues.');
      },
```

Replace with:

```js
      onClosed: () => {
        floatingCamStop = null;
        restoreInPagePreview();
        ports.setStatus('Floating camera closed — will reopen next time you tab away.');
      },
```

- [ ] **Step 6: Run typecheck and the full test suite — still nothing should break**

```bash
cd /home/toyin/mool/app && npm run typecheck && npm test
```

Expected: typecheck clean, all existing vitest tests pass. The new code is isolated to `recorder.js`, which is not exercised by any test.

- [ ] **Step 7: Smoke-test the hybrid matrix**

Restart the dev server if needed:

```bash
cd /home/toyin/mool/app && npm run dev
```

In Chromium, open `http://localhost:3000` and run through the matrix from spec §8. Each row should pass before committing.

- [ ] Camera on, click Start, share any tab, **stay on the Mool tab**. In-page bubble visible. **No PIP window opens** (this is the behavior change vs Task 1).
- [ ] Tab away to the recorded tab. Within ~300 ms the PIP appears with the camera. The in-page bubble disappears from the Mool tab.
- [ ] Tab back to Mool. PIP closes. In-page bubble reappears.
- [ ] Tab away again. Fresh PIP opens.
- [ ] Tab away, click X on the PIP. PIP gone, recording continues, status reads `Floating camera closed — will reopen next time you tab away.`
- [ ] Tab back to Mool (after manual close). In-page bubble reappears (no PIP to close).
- [ ] Tab away again (after manual close). Fresh PIP opens (manual close was for one cycle only).
- [ ] Click Stop in the PIP from a recorded tab. Recording stops; share link appears on the Mool tab.
- [ ] Click Stop on the Mool tab while the PIP is open in another window. Recording stops; PIP closes.
- [ ] Camera off, full recording cycle. No listener activity, no PIP, no behavior change vs camera-on-with-PIP-disabled paths.
- [ ] Rapid `cmd+tab` flicking during recording. No console errors. PIP either open or closed at rest, never stuck "opening." The module's existing `closeRequested` flag handles the late-arriving-window race.

If any row fails, fix before committing.

- [ ] **Step 8: Smoke-test on Firefox or Safari (non-Chromium) to confirm no regression**

Open `http://localhost:3000` in Firefox or Safari. Tick Camera on — the existing `cam-pip-note` should appear (this is unchanged). Run a full recording cycle. The visibility listener must NOT be registered (because `floatingCamSupported` is false) and no PIP should ever open. The in-page bubble should behave exactly as on current main when Camera on is enabled.

If you see any change in behavior on FF/Safari, the `floatingCamSupported` guard around `setupVisibilityHandling()` is wrong — fix before committing.

- [ ] **Step 9: Commit**

```bash
cd /home/toyin/mool && git add app/src/public/recorder.js && git commit -m "$(cat <<'EOF'
feat(recorder): hybrid camera overlay — in-page on Mool, PIP off-tab

Switch the floating PIP trigger from "always open at recording start"
to a visibilitychange-driven open/close cycle. While the user is on the
Mool tab they see the clean in-page bubble; while they're on any other
tab or window the PIP follows them. Document PIP module is unchanged —
the trigger is a thin reactive wrapper in recorder.js.

Manual close mid-recording is treated as "hide it for this hidden
period only" — the next visibility transition to hidden opens a fresh
PIP. Status message updated to spell that out so the behavior isn't
surprising.

On non-Chromium browsers (no Document PIP), the visibility listener is
never registered; in-page preview behavior is unchanged.

Spec: docs/superpowers/specs/2026-05-11-hybrid-camera-overlay-design.md

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes

- **Spec coverage:**
  - §3 The rule — Task 2 step 2 (the `visibilityListener` body) and step 3 (the `if (document.hidden)` gate at recording start). ✓
  - §4 Happy path — Task 2 step 7 row 1 (in-page on Mool), row 2 (PIP off-tab), row 3 (close on return). ✓
  - §4 Manual close — Task 2 step 5 (status message) + Task 1 step 1 `onClosed` (`restoreInPagePreview()` unconditionally) + Task 2 step 7 rows 5–7. ✓
  - §5 Failure modes — `requestWindow` rejects: `onError` in `openFloatingCamIfClosed` restores preview. Camera-end mid-recording: Task 1 step 3 (`onCameraEnded` calls `closeFloatingCamIfOpen`). Rapid flicks: existing module behavior, smoke-test row 11. ✓
  - §6 Architecture — all four helpers present (Task 1 step 1, Task 2 step 2). ✓
  - §7 Files touched — only `recorder.js` modified. ✓
  - §8 Testing — Task 2 step 7 covers the manual matrix; Task 2 step 8 covers the FF/Safari row. ✓
- **Placeholder scan:** none.
- **Type consistency:** all four helpers are zero-arg returning void; all share the four module-locals (`floatingCamStop`, `cameraStream`, `floatingCamSupported`, `visibilityListener`).
