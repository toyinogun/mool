# Live Camera Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Document Picture-in-Picture "always-on-top" camera bubble that opens automatically when recording starts on Chromium browsers, with a Stop button inside the bubble. Closes [#20](https://github.com/toyinogun/mool/issues/20).

**Architecture:** A new `recorderFloatingCam.js` module mirrors `recorderComposite.js` — owns the Document PIP lifecycle, exposes an opaque `{ close }` handle. The adapter (`recorder.js`) calls it from inside the existing `startCapture` and `releaseStream` ports. The state machine (`recorderFlow.js`) is untouched. Non-Chromium browsers (Firefox/Safari) skip the bubble; a non-blocking note in the page surfaces the limitation.

**Tech Stack:** Vanilla JS (ESM, no bundler), JSDoc types per ADR-0012, vitest in `node` env (no DOM library; new module follows v0.3 precedent of no unit tests for DOM-coupled code), Chromium Document Picture-in-Picture API.

**Spec:** [`docs/superpowers/specs/2026-05-11-live-camera-overlay-design.md`](../specs/2026-05-11-live-camera-overlay-design.md). Read before starting.

**Working directory:** All paths are relative to `/home/toyin/mool`. All `npm` commands run from `/home/toyin/mool/app`.

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `app/src/public/recorderFloatingCam.js` | **Create** | Owns Document PIP window lifecycle. Exports `isFloatingCamSupported()` and `openFloatingCam()`. Only file allowed to touch `window.documentPictureInPicture`. |
| `app/src/public/recorder.js` | Modify | Capability probe at boot; `floatingCamStop` handle; `suspendInPagePreview()` / `restoreInPagePreview()` helpers; wiring inside `startCapture`, `releaseStream`, and the existing `composite.onCameraEnded` callback; show/hide note on camera-toggle change. |
| `app/src/public/index.html` | Modify | Add `<p id="cam-pip-note" class="note" hidden>…</p>` between the preview area and the controls row. |
| `app/src/public/styles.css` | Modify | Add `.note` rule (small, muted, italic). |

Untouched: `recorderFlow.js`, `recorderEffects.js`, `recorderCapture.js`, `recorderComposite.js`, `recorderUpload.js`, all server files, all test files.

---

## Notes on testing in this plan

The project's vitest environment is `node` (no jsdom). Per spec §11 and the v0.3 precedent set for `recorderComposite.js`, the new DOM-coupled module **does not get unit tests** — correctness is verified by the manual smoke matrix at the end. Per-task verification uses `node --check` for syntax and a quick browser load to confirm no runtime errors.

---

## Notes on the user-activation risk (spec §8)

`documentPictureInPicture.requestWindow()` requires transient user activation. The plan implements **Plan A** (rely on activation surviving the `getDisplayMedia` await). Verification happens in Task 7's smoke matrix item #1: if the bubble fails to open with a `NotAllowedError` referencing user gesture, switch to **Task 8 (Plan B fallback)** — pre-open the window from the click handler. Skip Task 8 if Plan A works.

---

### Task 1: Create the `recorderFloatingCam.js` module

**Files:**
- Create: `app/src/public/recorderFloatingCam.js`

The module exposes a sync `openFloatingCam()` that returns `{ close }` immediately, but kicks off `requestWindow()` asynchronously inside. This lets `recorder.js`'s synchronous `startCapture` port keep its current shape. If `requestWindow()` rejects after the call (e.g. activation gone), the optional `onError` callback fires so the adapter can surface a status message and restore the in-page preview. If `close()` is called before the window opens, the resolved window is closed immediately on arrival.

- [ ] **Step 1: Write the full module file**

Create `app/src/public/recorderFloatingCam.js` with the following content:

```js
/**
 * Document Picture-in-Picture overlay for the live camera during recording.
 *
 * Opens an always-on-top floating window populated with a mirrored <video>
 * fed by the same camera MediaStream that the in-page preview uses, plus a
 * Stop button that dispatches StopClicked back into the recorder via the
 * supplied callback. Lets the user keep visual feedback while their tab is
 * backgrounded, and stop the recording without switching back to the Mool
 * tab.
 *
 * Only Chromium-based browsers expose `window.documentPictureInPicture`.
 * On Firefox/Safari, callers guard with `isFloatingCamSupported()` and skip
 * opening the bubble; the in-page note in index.html surfaces the
 * limitation to the user.
 *
 * Boundary: this module is the only place allowed to touch
 * `window.documentPictureInPicture` or build the bubble's DOM. Callers
 * receive only an opaque `{ close }` handle. The bubble's <video> reuses
 * the existing `.cam-preview` rule from styles.css, carried over by
 * `requestWindow({ copyStyleSheets: true })`.
 *
 * Async-but-sync-handle pattern: `openFloatingCam` returns immediately so
 * the synchronous `startCapture` port in recorder.js doesn't have to grow
 * an await. Internally a self-invoking async IIFE awaits
 * `requestWindow()`, populates the window, and surfaces late failures via
 * the optional `onError` callback. If `close()` runs before the window
 * arrives, the resolved window is disposed on arrival.
 *
 * @typedef {{ close: () => void }} FloatingCamHandle
 */

/**
 * Probe for Document Picture-in-Picture support. Safe to call at any time.
 *
 * @returns {boolean}
 */
export function isFloatingCamSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

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
  /** @type {any} */
  const dpip = /** @type {any} */ (window).documentPictureInPicture;
  if (!dpip || typeof dpip.requestWindow !== 'function') {
    throw new Error('openFloatingCam: documentPictureInPicture is unavailable');
  }

  let closeRequested = false;
  /** @type {Window | null} */
  let pipWindow = null;
  /** @type {HTMLVideoElement | null} */
  let video = null;

  // Async open. The handle returned below is live the moment this returns,
  // but `close()` and `pipWindow` are coordinated by the closeRequested flag
  // so closing-before-open works.
  void (async () => {
    /** @type {Window} */
    let win;
    try {
      win = await dpip.requestWindow({
        width,
        height,
        copyStyleSheets: true,
      });
    } catch (err) {
      if (!closeRequested && onError) {
        try { onError(err); } catch { /* one bad listener shouldn't stop teardown */ }
      }
      return;
    }
    if (closeRequested) {
      try { win.close(); } catch { /* idempotent */ }
      return;
    }
    pipWindow = win;
    populate(win);
  })();

  /** @param {Window} win */
  function populate(win) {
    const doc = win.document;

    // Tight layout. Dark background so the brief gap before <video>'s first
    // painted frame reads as "loading" rather than "broken".
    doc.body.style.margin = '0';
    doc.body.style.display = 'flex';
    doc.body.style.flexDirection = 'column';
    doc.body.style.alignItems = 'center';
    doc.body.style.justifyContent = 'center';
    doc.body.style.gap = '12px';
    doc.body.style.padding = '12px';
    doc.body.style.background = '#111';

    // <video>: reuses the .cam-preview rule (circle + mirror) carried over
    // by copyStyleSheets.
    video = doc.createElement('video');
    video.className = 'cam-preview';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = cameraStream;
    void video.play().catch(() => {
      /* play() rejects if the element is removed before it resolves; harmless. */
    });
    doc.body.appendChild(video);

    // Stop button.
    const stopBtn = doc.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'primary';
    stopBtn.textContent = 'Stop';
    doc.body.appendChild(stopBtn);

    let stopFired = false;
    stopBtn.addEventListener('click', () => {
      if (stopFired) return;
      stopFired = true;
      try { onStopClicked(); } catch { /* swallow — caller surfaces */ }
    });

    // Manual-close detection. closeRequested is set by `close()` below, so
    // pagehide caused by our own close() does NOT fire onClosed.
    let closedFired = false;
    win.addEventListener('pagehide', () => {
      if (closeRequested) return;
      if (closedFired) return;
      closedFired = true;
      if (onClosed) {
        try { onClosed(); } catch { /* swallow */ }
      }
    });
  }

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

  return { close };
}
```

- [ ] **Step 2: Verify the file parses**

Run: `node --check app/src/public/recorderFloatingCam.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Verify the existing test suite still passes**

Run from `/home/toyin/mool/app`: `npm test`
Expected: all existing tests pass. The new module isn't imported by anything yet, so nothing should change.

- [ ] **Step 4: Commit**

```bash
git -C /home/toyin/mool add app/src/public/recorderFloatingCam.js
git -C /home/toyin/mool commit -m "feat(recorderFloatingCam): document PIP overlay module

Adds isFloatingCamSupported() probe and openFloatingCam() factory.
Sync return, async-internal requestWindow, idempotent close(),
manual-close vs programmatic-close distinction via flag.

Not yet wired into the adapter — see follow-up commits."
```

---

### Task 2: Add the `.note` CSS rule

**Files:**
- Modify: `app/src/public/styles.css` (append a new rule near the bottom, after the existing `.link-button` block)

- [ ] **Step 1: Append the `.note` rule**

Add this to the end of `app/src/public/styles.css`:

```css
.note {
  margin: 0.5rem 0 1rem;
  color: var(--muted);
  font-size: 0.9rem;
  font-style: italic;
}
.note[hidden] { display: none; }
```

- [ ] **Step 2: Commit**

```bash
git -C /home/toyin/mool add app/src/public/styles.css
git -C /home/toyin/mool commit -m "style: add .note rule for ambient page notices"
```

---

### Task 3: Add the unsupported-browser note element to `index.html`

**Files:**
- Modify: `app/src/public/index.html`

The note is hidden by default. Task 4 wires the boot-time probe and toggle handler that controls its visibility.

- [ ] **Step 1: Insert the note element between the preview area and the controls**

In `app/src/public/index.html`, find this section (currently at lines 30–34):

```html
      <div id="cam-preview-hidden" class="cam-preview-hidden" hidden>
        <span>Camera on, preview hidden</span>
        <button type="button" id="cam-preview-show" class="link-button" aria-label="Show camera preview">Show</button>
      </div>

      <div class="controls">
```

Insert a new `<p>` element between the closing `</div>` of `cam-preview-hidden` and the opening `<div class="controls">`, so it reads:

```html
      <div id="cam-preview-hidden" class="cam-preview-hidden" hidden>
        <span>Camera on, preview hidden</span>
        <button type="button" id="cam-preview-show" class="link-button" aria-label="Show camera preview">Show</button>
      </div>

      <p id="cam-pip-note" class="note" hidden>
        Live camera overlay isn't supported in this browser. Recording still works; the camera will appear in the saved video.
      </p>

      <div class="controls">
```

- [ ] **Step 2: Reload the page in a browser to confirm it does NOT appear yet**

Run from `/home/toyin/mool/app`: `npm run dev`
Open `http://localhost:3000` (or whatever port the dev server reports — check the terminal output).
Confirm: the note is NOT visible (because `hidden` is set and nothing has unhidden it). Page layout is unchanged.

Stop the dev server with Ctrl+C.

- [ ] **Step 3: Commit**

```bash
git -C /home/toyin/mool add app/src/public/index.html
git -C /home/toyin/mool commit -m "ui: add hidden cam-pip-note element for FF/Safari warning"
```

---

### Task 4: Wire boot-time probe + toggle visibility for the note in `recorder.js`

**Files:**
- Modify: `app/src/public/recorder.js`

This task:
1. Imports `isFloatingCamSupported` from the new module.
2. Looks up the new note element.
3. Runs the probe at module load and stashes the result in a constant.
4. In the camera-toggle change handler, shows the note when toggling on (only on unsupported browsers); hides it when toggling off.
5. In `showCamFailure()` (toggle bounces back to off after permission denial), also hides the note.

- [ ] **Step 1: Add the import**

In `app/src/public/recorder.js`, find the existing imports near the top (lines 19–26):

```js
import { initialState, transition } from './recorderFlow.js';
import {
  mintUpload as mintUploadRequest,
  putBytes as putBytesRequest,
} from './recorderUpload.js';
import { createCapture } from './recorderCapture.js';
import { runEffect } from './recorderEffects.js';
import { composeStreams } from './recorderComposite.js';
```

Add a new import line at the end of that block:

```js
import { isFloatingCamSupported, openFloatingCam } from './recorderFloatingCam.js';
```

(`openFloatingCam` will be used in Task 6; importing both now keeps the import block stable.)

- [ ] **Step 2: Add the note element lookup and the probe constant**

Find the DOM lookups block (lines 28–41). After the existing `camPreviewShowBtn` line, append:

```js
const camPipNote = /** @type {HTMLElement} */ (document.getElementById('cam-pip-note'));

const floatingCamSupported = isFloatingCamSupported();
```

- [ ] **Step 3: Update `turnCameraOn` to show the note on unsupported browsers**

Find `turnCameraOn` (currently around lines 191–237). After the existing `if (previewVisible) { ... } else { ... }` block at the end of the function (the block that sets `camPreviewWrap.hidden` / `camPreviewHidden.hidden`), append:

```js
  if (!floatingCamSupported) {
    camPipNote.hidden = false;
  }
```

So the tail of `turnCameraOn` reads:

```js
  cameraStream = stream;
  camPreviewVideo.srcObject = stream;
  void camPreviewVideo.play().catch(() => {});
  if (previewVisible) {
    camPreviewWrap.hidden = false;
    camPreviewHidden.hidden = true;
  } else {
    camPreviewWrap.hidden = true;
    camPreviewHidden.hidden = false;
  }
  if (!floatingCamSupported) {
    camPipNote.hidden = false;
  }
}
```

- [ ] **Step 4: Update `turnCameraOff` to hide the note**

Find `turnCameraOff` (currently around lines 239–248). Append a new line at the end of the function before the closing `}`:

```js
  camPipNote.hidden = true;
```

So the function reads:

```js
function turnCameraOff() {
  camGen++;
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  camPreviewVideo.srcObject = null;
  camPreviewWrap.hidden = true;
  camPreviewHidden.hidden = true;
  camPipNote.hidden = true;
}
```

- [ ] **Step 5: Update `showCamFailure` to hide the note**

Find `showCamFailure` (currently around lines 256–263). Append a new line before `ports.setStatus(message);`:

```js
  camPipNote.hidden = true;
```

So the function reads:

```js
function showCamFailure(message) {
  camToggleEl.checked = false;
  cameraStream = null;
  camPreviewVideo.srcObject = null;
  camPreviewWrap.hidden = true;
  camPreviewHidden.hidden = true;
  camPipNote.hidden = true;
  ports.setStatus(message);
}
```

- [ ] **Step 6: Verify the file parses**

Run: `node --check app/src/public/recorder.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Verify in browser (Chromium)**

Run from `/home/toyin/mool/app`: `npm run dev`
Open the page in Chrome. Toggle the camera on (allow permission). Confirm the note does NOT appear (Chrome supports Document PIP).
Toggle off — preview disappears, note remains hidden.
Stop the dev server with Ctrl+C.

- [ ] **Step 8: Verify in browser (Firefox or Safari, if available)**

If you have Firefox or Safari handy, repeat: toggle camera on → note appears with the unsupported text → toggle off → note disappears.

If no FF/Safari available, simulate by opening Chrome devtools → Console → run `delete window.documentPictureInPicture` BEFORE toggling the camera on. Then toggle camera on; the note should appear. (Note: the probe runs at page load; you must run the delete and then reload + re-run the delete in console BEFORE toggling, OR simply edit `floatingCamSupported = false` temporarily for the smoke check. Easiest: edit the line `const floatingCamSupported = isFloatingCamSupported();` to `const floatingCamSupported = false;` temporarily, reload, verify the note appears, then revert.)

- [ ] **Step 9: Commit**

```bash
git -C /home/toyin/mool add app/src/public/recorder.js
git -C /home/toyin/mool commit -m "feat(recorder): show unsupported-browser note when camera is on

Boot-time probe via isFloatingCamSupported(). Note shows when the
camera toggle goes on AND the browser lacks documentPictureInPicture.
Hides on toggle-off and on toggle bounceback after permission failure."
```

---

### Task 5: Add `suspendInPagePreview` / `restoreInPagePreview` helpers in `recorder.js`

**Files:**
- Modify: `app/src/public/recorder.js`

These helpers don't change visible behavior yet — they're called by Task 6. Adding them here as a separate commit makes the diff in Task 6 smaller and easier to read.

The helpers use a module-local `previewSuspended` flag so the existing `cam-preview-toggle` / `cam-preview-show` button handlers (and `turnCameraOn`/`turnCameraOff`) can be made suspension-aware.

- [ ] **Step 1: Add the `previewSuspended` flag**

In `app/src/public/recorder.js`, find the module-local state block (lines 43–58). Below the existing `previewVisible` declaration, add:

```js
let previewSuspended = false;
```

- [ ] **Step 2: Add the helper functions**

Add these two functions just above the existing `turnCameraOn` function (around line 191):

```js
/**
 * Hide both in-page preview affordances (visible circle and the
 * "preview hidden" placeholder) while the floating-cam bubble is open.
 * Records the suspension in a flag so other preview-state changes don't
 * accidentally re-show the in-page preview.
 */
function suspendInPagePreview() {
  previewSuspended = true;
  camPreviewWrap.hidden = true;
  camPreviewHidden.hidden = true;
}

/**
 * Reverse `suspendInPagePreview()`. Re-applies the visibility rule from
 * `previewVisible` (which is unchanged across suspend/restore). No-op if
 * the camera has been turned off in the meantime.
 */
function restoreInPagePreview() {
  if (!previewSuspended) return;
  previewSuspended = false;
  if (!cameraStream) return;
  if (previewVisible) {
    camPreviewWrap.hidden = false;
    camPreviewHidden.hidden = true;
  } else {
    camPreviewWrap.hidden = true;
    camPreviewHidden.hidden = false;
  }
}
```

- [ ] **Step 3: Make the existing preview-toggle handlers suspension-aware**

Find the `camPreviewToggleBtn` and `camPreviewShowBtn` click handlers (lines 179–189):

```js
camPreviewToggleBtn.addEventListener('click', () => {
  previewVisible = false;
  camPreviewWrap.hidden = true;
  camPreviewHidden.hidden = false;
});

camPreviewShowBtn.addEventListener('click', () => {
  previewVisible = true;
  camPreviewHidden.hidden = true;
  camPreviewWrap.hidden = false;
});
```

Replace them with versions that no-op the visible toggling while suspended (the user shouldn't be able to interact with the buttons because they're hidden, but we keep `previewVisible` accurate for the eventual restore):

```js
camPreviewToggleBtn.addEventListener('click', () => {
  previewVisible = false;
  if (previewSuspended) return;
  camPreviewWrap.hidden = true;
  camPreviewHidden.hidden = false;
});

camPreviewShowBtn.addEventListener('click', () => {
  previewVisible = true;
  if (previewSuspended) return;
  camPreviewHidden.hidden = true;
  camPreviewWrap.hidden = false;
});
```

- [ ] **Step 4: Make `turnCameraOn` suspension-aware**

In `turnCameraOn`, the tail (post-permission-grant) currently sets the preview visibility unconditionally. Wrap that block in a `previewSuspended` guard. Find this in `turnCameraOn`:

```js
  cameraStream = stream;
  camPreviewVideo.srcObject = stream;
  void camPreviewVideo.play().catch(() => {});
  if (previewVisible) {
    camPreviewWrap.hidden = false;
    camPreviewHidden.hidden = true;
  } else {
    camPreviewWrap.hidden = true;
    camPreviewHidden.hidden = false;
  }
  if (!floatingCamSupported) {
    camPipNote.hidden = false;
  }
}
```

Replace with:

```js
  cameraStream = stream;
  camPreviewVideo.srcObject = stream;
  void camPreviewVideo.play().catch(() => {});
  if (!previewSuspended) {
    if (previewVisible) {
      camPreviewWrap.hidden = false;
      camPreviewHidden.hidden = true;
    } else {
      camPreviewWrap.hidden = true;
      camPreviewHidden.hidden = false;
    }
  }
  if (!floatingCamSupported) {
    camPipNote.hidden = false;
  }
}
```

(Note: `turnCameraOn` only runs when the user toggles the camera on. The camera toggle is disabled while a recording is in flight via `setButtons`, so in practice `previewSuspended` won't be true during `turnCameraOn`. The guard is defensive.)

- [ ] **Step 5: Verify the file parses**

Run: `node --check app/src/public/recorder.js`
Expected: no output, exit code 0.

- [ ] **Step 6: Verify in browser**

Run from `/home/toyin/mool/app`: `npm run dev`
Open the page in Chrome. Confirm the existing camera-toggle / hide-preview / show-preview behavior is **unchanged** (you've added helpers and a flag, but the flag is never set to true yet).
Stop the dev server with Ctrl+C.

- [ ] **Step 7: Commit**

```bash
git -C /home/toyin/mool add app/src/public/recorder.js
git -C /home/toyin/mool commit -m "refactor(recorder): add suspend/restore preview helpers

Introduces previewSuspended flag plus suspendInPagePreview() and
restoreInPagePreview() helpers. Existing toggle/show handlers and
turnCameraOn() respect the flag. No behavior change yet — the
floating-cam wiring in the next commit is the first caller."
```

---

### Task 6: Wire `openFloatingCam` into `startCapture` and `releaseStream`

**Files:**
- Modify: `app/src/public/recorder.js`

This is the main integration. The bubble opens when `startCapture` runs with a camera stream and the API is supported; closes when `releaseStream` runs.

- [ ] **Step 1: Add the `floatingCamStop` handle alongside the existing `composeStop`**

Find this comment block + declaration (lines 51–58):

```js
/**
 * Cancellation handle for the active canvas composite. Captured in
 * startCapture() when videoEnabled && cameraStream, consumed in
 * releaseStream() before capture.release() and nulled. Null otherwise
 * (camera-off recording, or before any recording has started).
 * @type {(() => void) | null}
 */
let composeStop = null;
```

Append a parallel declaration immediately after it:

```js
/**
 * Cancellation handle for the active floating-camera overlay. Captured in
 * startCapture() when videoEnabled && cameraStream && floatingCamSupported,
 * consumed in releaseStream() before capture.release() (and also by the
 * onCameraEnded callback, see below), and nulled. Null otherwise.
 * @type {(() => void) | null}
 */
let floatingCamStop = null;
```

- [ ] **Step 2: Open the floating cam inside `startCapture`**

Find the `startCapture` port (lines 120–139):

```js
  startCapture(stream, audioStream, videoEnabled, onTrackEnded) {
    if (videoEnabled && cameraStream) {
      const composite = composeStreams({
        screenStream: stream,
        cameraStream,
      });
      composeStop = composite.stop;
      composite.onCameraEnded(() => {
        ports.setStatus('Camera disconnected — continuing with screen only.');
      });
      // capture.start receives the composite stream as its "screen" stream.
      // Audio merging stays in capture (single source of truth for mime
      // negotiation). The composite track ending — driven by the screen
      // track ending in composeStreams — propagates as TrackEnded via
      // capture's onended wiring on the merged stream's tracks.
      capture.start(composite.compositeStream, audioStream, onTrackEnded);
    } else {
      capture.start(stream, audioStream, onTrackEnded);
    }
  },
```

Replace with:

```js
  startCapture(stream, audioStream, videoEnabled, onTrackEnded) {
    if (videoEnabled && cameraStream) {
      const composite = composeStreams({
        screenStream: stream,
        cameraStream,
      });
      composeStop = composite.stop;
      composite.onCameraEnded(() => {
        ports.setStatus('Camera disconnected — continuing with screen only.');
        if (floatingCamStop) {
          floatingCamStop();
          floatingCamStop = null;
          restoreInPagePreview();
        }
      });
      // capture.start receives the composite stream as its "screen" stream.
      // Audio merging stays in capture (single source of truth for mime
      // negotiation). The composite track ending — driven by the screen
      // track ending in composeStreams — propagates as TrackEnded via
      // capture's onended wiring on the merged stream's tracks.
      capture.start(composite.compositeStream, audioStream, onTrackEnded);

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
    } else {
      capture.start(stream, audioStream, onTrackEnded);
    }
  },
```

- [ ] **Step 3: Close the floating cam inside `releaseStream`**

Find the `releaseStream` port (lines 111–117):

```js
  releaseStream() {
    if (composeStop) {
      composeStop();
      composeStop = null;
    }
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
    if (floatingCamStop) {
      floatingCamStop();
      floatingCamStop = null;
    }
    restoreInPagePreview();
    capture.release();
  },
```

(`restoreInPagePreview` is a no-op if `previewSuspended` is false, so this is safe in the camera-off path too.)

- [ ] **Step 4: Verify the file parses**

Run: `node --check app/src/public/recorder.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Smoke-test the happy path in Chrome**

Run from `/home/toyin/mool/app`: `npm run dev`
Open the page in Chrome.
1. Toggle the camera on (allow permission). The in-page preview circle appears.
2. Click "Start Recording". Pick a screen source.
3. **Expected:** the floating camera bubble opens (always-on-top), showing the live mirrored camera and a Stop button. The in-page preview disappears.
4. Switch to another tab/app. The bubble stays visible.
5. Click Stop in the bubble.
6. **Expected:** the bubble closes, the in-page preview reappears, the share-link UI shows.

If the bubble fails to open with a `NotAllowedError` referencing user gesture: Plan A failed. Stop the dev server, **commit what you have**, then proceed to Task 8 (Plan B fallback). Do NOT skip ahead — the commit captures a working state for non-camera recordings even if Plan A failed.

If the bubble opens but doesn't close cleanly, or the in-page preview doesn't reappear, debug before committing.

Stop the dev server with Ctrl+C.

- [ ] **Step 6: Smoke-test the camera-off path**

Restart the dev server. Without toggling the camera, click Start, pick a screen source, click Stop. **Expected:** no bubble appears, recording flow is identical to today. Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git -C /home/toyin/mool add app/src/public/recorder.js
git -C /home/toyin/mool commit -m "feat(recorder): open document PIP camera overlay during recording

Closes #20. On Chromium with the camera toggle on, opens an
always-on-top floating bubble at recording start, hosting a mirrored
<video> and a Stop button that dispatches StopClicked. In-page
preview is suspended for the bubble's lifetime and restored on
recording stop. Manual close, requestWindow rejection, and camera
disconnect mid-recording all degrade gracefully."
```

---

### Task 7: Run the manual smoke matrix

This task runs the full manual smoke matrix from spec §11. No code changes unless something fails.

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run from `/home/toyin/mool/app`: `npm run dev`

- [ ] **Step 2: Smoke 1 — Chrome desktop, camera on, happy path**

(Already covered in Task 6 Step 5; re-run to confirm nothing regressed.)
1. Toggle camera on → preview appears.
2. Click Start → pick screen source → bubble opens, in-page preview hides.
3. Tab away → bubble stays visible.
4. Click Stop in bubble → bubble closes → in-page preview reappears → share-link UI shows.

**Pass:** all of the above. **Fail:** debug, fix, recommit.

- [ ] **Step 3: Smoke 2 — Chrome, manual close mid-recording**

1. Toggle camera on → click Start → pick screen source → bubble opens.
2. Click the OS close button on the bubble window (NOT the in-bubble Stop button).
3. **Expected:** status text shows "Floating camera closed — recording continues." In-page preview reappears.
4. Click Stop on the Mool tab.
5. **Expected:** recording uploads, share link appears.

- [ ] **Step 4: Smoke 3 — Chrome, camera off**

1. Camera toggle OFF → click Start → pick screen source.
2. **Expected:** no bubble appears. Recording flow is identical to v0.3 camera-off path.
3. Click Stop. Recording uploads.

- [ ] **Step 5: Smoke 4 — Firefox or Safari (if available)**

If you have Firefox or Safari installed:
1. Toggle camera on → note appears with the unsupported text.
2. Click Start → pick screen source.
3. **Expected:** no bubble. Recording proceeds normally.
4. Click Stop. Verify the recording uploads and the playback shows the camera composited in the bottom-left (v0.3 behavior intact).

If no FF/Safari available, skip this step and document it as untested in the smoke notes.

- [ ] **Step 6: Smoke 5 — Chrome, camera disconnect mid-recording**

1. Toggle camera on → click Start → pick screen source → bubble opens.
2. **Trigger camera-end:** in Chrome's address bar, click the camera icon → "Reset permission and reload" — OR simpler: physically unplug a USB webcam if you're using one.
3. **Expected:** status text shows "Camera disconnected — continuing with screen only." Bubble closes. In-page preview reappears.
4. Click Stop on the Mool tab. Recording uploads. Playback shows camera-then-no-camera.

(If neither method is convenient, this can be tested by stubbing the camera track in devtools: `cameraStream.getVideoTracks()[0].stop()` — find the variable via the recorder.js source. Or skip and document as untested.)

- [ ] **Step 7: Smoke 6 — Chrome, requestWindow rejected**

Simulate the API failing mid-flight by stubbing in devtools BEFORE clicking Start:

In Chrome devtools console (with the Recorder page open, camera toggled on):

```js
const realRequestWindow = window.documentPictureInPicture.requestWindow.bind(window.documentPictureInPicture);
window.documentPictureInPicture.requestWindow = () => Promise.reject(new Error('test stub'));
```

Then click Start, pick a screen source.
**Expected:** status text shows "Floating camera unavailable — recording continues without overlay." In-page preview stays visible (was never suspended). Recording proceeds. Click Stop. Upload completes.

Restore: `window.documentPictureInPicture.requestWindow = realRequestWindow;`

- [ ] **Step 8: Stop the dev server and record results**

Stop the dev server with Ctrl+C.

Note the smoke results for the PR description: which paths passed, which were untested (e.g. FF/Safari if unavailable). No code changes; nothing to commit.

---

### Task 8: Plan B fallback — pre-open the PIP window from the click handler

> **Skip this task if Task 7 Smoke 1 passed.** Only run if the bubble fails to open with an activation/user-gesture error.

**Files:**
- Modify: `app/src/public/recorderFloatingCam.js`
- Modify: `app/src/public/recorder.js`

This task changes the activation strategy: open the bubble synchronously from the Start click handler (where activation is fresh), and pass the opened `Window` into `openFloatingCam` instead of letting it call `requestWindow` itself.

- [ ] **Step 1: Extend `openFloatingCam` to accept a pre-opened window**

In `app/src/public/recorderFloatingCam.js`, update the function signature to accept an optional `pipWindow` (a `Window` or a `Promise<Window>`):

```js
/**
 * @param {{
 *   cameraStream: MediaStream,
 *   onStopClicked: () => void,
 *   onClosed?: () => void,
 *   onError?: (err: unknown) => void,
 *   width?: number,
 *   height?: number,
 *   pipWindow?: Window | Promise<Window>,
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
  pipWindow: pipWindowArg,
}) {
```

In the function body, replace the `void (async () => { ... })();` block with one that uses `pipWindowArg` when provided:

```js
  void (async () => {
    /** @type {Window} */
    let win;
    try {
      if (pipWindowArg) {
        win = await pipWindowArg;
      } else {
        win = await dpip.requestWindow({
          width,
          height,
          copyStyleSheets: true,
        });
      }
    } catch (err) {
      if (!closeRequested && onError) {
        try { onError(err); } catch { /* swallow */ }
      }
      return;
    }
    if (closeRequested) {
      try { win.close(); } catch { /* idempotent */ }
      return;
    }
    pipWindow = win;
    populate(win);
  })();
```

Note: the destructured local is renamed to `pipWindowArg` so it doesn't shadow the existing module-local `pipWindow` variable used inside the IIFE.

Verify: `node --check app/src/public/recorderFloatingCam.js` → no errors.

- [ ] **Step 2: Add `pendingPipWindow` to the module-locals and pre-open in the Start handler**

In `app/src/public/recorder.js`, find the existing module-locals block from Task 6 Step 1 (the `composeStop` and `floatingCamStop` declarations). Append a third declaration:

```js
/**
 * Pre-opened Document PIP window awaiting wire-up. Set in the Start
 * click handler (Plan B), consumed in startCapture(), or cleaned up in
 * releaseStream() if Start failed (mic/screen denied) before the camera
 * stream made it to startCapture.
 * @type {Promise<Window> | null}
 */
let pendingPipWindow = null;
```

Then find the Start button click handler (currently `startBtn.addEventListener('click', ...)` at line 165) and replace it with:

```js
startBtn.addEventListener('click', () => {
  // Plan B: pre-open the PIP window synchronously here, where user
  // activation is fresh. The promise is consumed by startCapture() below
  // (or cleaned up in releaseStream() if Start fails first).
  if (camToggleEl.checked && cameraStream && floatingCamSupported) {
    try {
      pendingPipWindow = /** @type {any} */ (window).documentPictureInPicture.requestWindow({
        width: 240,
        height: 280,
        copyStyleSheets: true,
      });
    } catch {
      pendingPipWindow = null;
    }
  } else {
    pendingPipWindow = null;
  }
  dispatch({ type: 'StartClicked', audioEnabled: micToggleEl.checked, videoEnabled: camToggleEl.checked });
});
```

- [ ] **Step 3: Pass the pre-opened window into `openFloatingCam`**

In `startCapture`, find the `openFloatingCam({ ... })` call from Task 6. Add a `pipWindow: pendingPipWindow` field at the end of the args object, and null `pendingPipWindow` immediately after so it isn't double-consumed:

```js
const handle = openFloatingCam({
  cameraStream,
  onStopClicked: () => dispatch({ type: 'StopClicked' }),
  onClosed: () => { ... },
  onError: () => { ... },
  pipWindow: pendingPipWindow,
});
pendingPipWindow = null;
floatingCamStop = handle.close;
suspendInPagePreview();
```

(Don't change the `onClosed` / `onError` callback bodies — they're identical to Task 6.)

- [ ] **Step 4: Clean up `pendingPipWindow` in `releaseStream`**

In `releaseStream`, the SM emits `ReleaseStream` on both success (Done) and failure (Failed) paths, so this is the safe cleanup point if Start failed before `startCapture` got a chance to consume `pendingPipWindow`.

Find the `releaseStream` port from Task 6 Step 3 and add a `pendingPipWindow` cleanup block before the existing `floatingCamStop` block:

```js
releaseStream() {
  if (composeStop) {
    composeStop();
    composeStop = null;
  }
  if (pendingPipWindow) {
    // Pre-opened window that never reached startCapture (Start failed at
    // mic/screen prompt). Resolve and close it so it doesn't dangle.
    const p = pendingPipWindow;
    pendingPipWindow = null;
    void p.then((win) => { try { win.close(); } catch { /* idempotent */ } })
          .catch(() => { /* requestWindow rejected; nothing to close */ });
  }
  if (floatingCamStop) {
    floatingCamStop();
    floatingCamStop = null;
  }
  restoreInPagePreview();
  capture.release();
},
```

- [ ] **Step 5: Verify the file parses**

Run:
```
node --check app/src/public/recorder.js
node --check app/src/public/recorderFloatingCam.js
```
Both: no output, exit code 0.

- [ ] **Step 6: Re-run Task 7 Smoke 1, plus the failure-cleanup check**

Run `npm run dev`. Click through:
1. **Happy path:** camera on → Start → pick source → bubble appears → Stop in bubble → upload.
2. **Failure cleanup:** camera on → Start → click Cancel on the screen-share picker. Status should show the v0.1 screen-share-denied message. **Confirm** there's no orphan bubble left open from the pre-open. (If there is, the `releaseStream` cleanup in Step 4 didn't run — check that the SM emits `ReleaseStream` on the screen-denied transition.)

**Note:** the happy-path bubble may appear briefly empty (~50–200ms) between the user picking a screen source and the camera stream being wired in. This is the documented gap from spec §12 risks. If it's visibly bad, raise it as a follow-up.

Stop the dev server.

- [ ] **Step 7: Commit**

```bash
git -C /home/toyin/mool add app/src/public/recorderFloatingCam.js app/src/public/recorder.js
git -C /home/toyin/mool commit -m "fix(recorderFloatingCam): pre-open PIP window in click handler (Plan B)

Plan A (relying on user activation surviving getDisplayMedia) failed
in current Chrome. Pre-open the PIP window synchronously in the Start
click handler where activation is fresh, then pass the resolved
Window into openFloatingCam. Documented gap: the bubble may appear
briefly empty between source pick and camera wiring."
```

---

## Self-review

After all tasks complete, the engineer should:

1. Confirm `git log --oneline` shows commits for: module created, CSS rule, HTML note element, recorder.js note wiring, recorder.js helpers, recorder.js bubble integration, and (optionally) the Plan B fallback if Task 8 ran.
2. Re-read spec §11 (Testing strategy) and confirm the manual smoke matrix is recorded — pass / fail / untested for each item — for the eventual PR description.
3. Open a PR titled `feat: live camera overlay during recording (#20)` with the smoke results in the body.
