# Mool — Live camera overlay during recording

**Date:** 2026-05-11
**Status:** Approved design, pending implementation plan
**Project root:** `/home/toyin/mool`
**Builds on:** [`2026-05-10-v0.3-webcam-pip-design.md`](./2026-05-10-v0.3-webcam-pip-design.md)
**Closes:** [#20 — Live camera overlay during recording](https://github.com/toyinogun/mool/issues/20)

## 1. Goal

Give the user a live always-on-top view of their camera while recording, so they keep visual feedback (am I in frame? camera on?) after they tab away from the Recorder page to the app they're recording. Today the in-page preview circle disappears the moment the Mool tab loses focus; the camera still gets composited into the saved file (v0.3), but during the recording itself the user is flying blind.

## 2. Scope

### In scope

- A floating, always-on-top camera bubble that opens automatically when recording starts (with the camera toggle on) and closes when recording stops.
- A Stop button inside the bubble that ends the recording without the user having to switch back to the Mool tab.
- The in-page preview circle hides while the bubble is open and reappears when recording stops.
- A capability probe at boot. On browsers without Document Picture-in-Picture support (Firefox, Safari), a non-blocking note appears near the camera toggle: recording still works, the camera still ends up in the saved file, but no live overlay.
- Graceful handling of: user closing the bubble manually mid-recording, camera disconnect mid-recording, `requestWindow()` rejection.

### Explicitly out of scope

- Elapsed timer inside the bubble. (Stop button is enough; user can glance at the Mool tab if they care about elapsed time.)
- Cross-browser parity. Firefox and Safari users get the in-file composite but no live overlay. Documented, not engineered around.
- Pop-out window fallback (`window.open` with a plain page) for non-Chromium browsers. Considered and rejected during brainstorming as too low-quality to justify the maintenance cost.
- Pause / resume controls in the bubble. Mool has no pause concept yet.
- Resizing or repositioning the bubble programmatically. The OS/user controls this.
- Custom styling of the bubble's chrome. We use the browser's default Document PIP frame.
- Any change to the recording pipeline, the composite, the upload path, or the viewer.

## 3. UI

### Recorder page

A small note element (initially hidden) sits below the toggle row:

```
[ 🎤 Mic on ✓ ]   [ 📷 Camera on ✓ ]
[ preview circle (when camera on, mirrored) ]
[ Live camera overlay isn't supported in this browser. Recording still ]
[ works; the camera will appear in the saved video. ]            ← only on FF/Safari
[  Start Recording  ]   [ Stop ]
```

Visibility rules for the note:

- Boot-time check: `'documentPictureInPicture' in window`. If false, the note is unhidden whenever the camera toggle is on, hidden whenever it's off.
- On Chromium browsers the note never appears.

### The bubble

Browser default Document PIP window, with two children:

```
┌──────────────────┐
│                  │
│    [ camera ]    │   ← <video>, mirrored, fills the window
│                  │
│   [   Stop   ]   │   ← button, sits at the bottom
│                  │
└──────────────────┘
```

- Initial size: ~240×280 CSS pixels (square camera area + room for the Stop button). The user can resize via the OS frame.
- The camera `<video>` is mirrored (CSS `transform: scaleX(-1)`), matching the in-page preview's mirroring convention from v0.3 §7. The recording itself is still un-mirrored (handled by the canvas composite, unchanged).
- The Stop button uses Mool's existing primary-button styling, carried in via `documentPictureInPicture.requestWindow({ copyStyleSheets: true })`.

## 4. User flow

### Happy path on Chromium

1. User toggles camera on → in-page preview circle appears (v0.3 behaviour, unchanged).
2. User clicks Start → mic prompt (if mic on) → screen-share prompt → screen source picked.
3. Composite stream is built (`composeStreams`, unchanged).
4. **New:** floating bubble opens, showing the live camera + Stop button. In-page preview hides.
5. User tabs to the app they're recording. Bubble stays on top.
6. User clicks Stop — either in the bubble or back on the Mool tab. Both produce the same `StopClicked` dispatch.
7. Bubble closes. In-page preview reappears (camera toggle is still on). Upload + share-link flow runs as in v0.3.

### Recording with camera off

Identical to v0.3. No bubble opens. No note shown. The Document PIP API is never touched.

### On Firefox or Safari

1. Page loads → capability probe runs → note text is prepared but hidden.
2. User toggles camera on → in-page preview appears AND the note becomes visible (so the user understands the limitation before clicking Start).
3. User clicks Start → recording proceeds exactly as in v0.3. No bubble, no error. Camera still ends up composited in the saved file.
4. User clicks Stop on the Mool tab.

## 5. Failure modes

| Failure | Where | What user sees | State after |
| --- | --- | --- | --- |
| `documentPictureInPicture` missing | Boot, FF/Safari | Note appears when camera toggle is on; recording still works | Recording proceeds, no bubble |
| `requestWindow()` rejects | After Start, camera on | Status: "Floating camera unavailable — recording continues without overlay." In-page preview stays visible. | `Capturing`; recording proceeds, no bubble |
| User closes the bubble manually mid-recording | During `Capturing` | Status: "Floating camera closed — recording continues." In-page preview reappears. | `Capturing` continues; user can re-Stop from the Mool tab |
| Camera track ends mid-recording (USB unplug, etc.) | During `Capturing` | v0.3 status ("Camera disconnected — continuing with screen only") **plus** the bubble closes automatically | `Capturing` continues, screen-only |
| Stop button in the bubble clicked while SM is past `Capturing` (in flight: stopping/uploading) | During `Stopping`/`MintingUrl`/`Uploading` | Click is a no-op. The bubble's close is driven by `releaseStream`, not by the Stop button itself. | Unchanged |

### Deliberate non-failures

**Recording does not block on PIP.** Every PIP-related failure (missing API, rejected `requestWindow`, manually-closed bubble) is non-fatal. The recording is the product; the bubble is feedback. This is the same line v0.3 drew for the camera disconnect — the user's primary signal (the screen) keeps recording.

**The state machine never learns about PIP.** No new states, no new effects, no new events. The bubble is a side-effect of "recording started with a camera," exactly like the canvas composite is — both live below the SM line, in the adapter.

## 6. Architecture

A new client module: `app/src/public/recorderFloatingCam.js`.

### Module surface

```js
/**
 * @returns {boolean} true iff Document Picture-in-Picture is available.
 */
export function isFloatingCamSupported();

/**
 * Open a Document PIP window populated with a mirrored camera <video>
 * and a Stop button.
 *
 * @param {{
 *   cameraStream: MediaStream,
 *   onStopClicked: () => void,
 *   onClosed?: () => void,
 *   width?: number,    // default 240
 *   height?: number,   // default 280
 * }} args
 * @returns {{ close: () => void }}
 */
export function openFloatingCam({ cameraStream, onStopClicked, onClosed, width, height });
```

### Boundary

`recorderFloatingCam.js` is the **only** file allowed to touch `window.documentPictureInPicture` or build the bubble's DOM. The adapter (`recorder.js`) holds an opaque `{ close }` handle and nothing more. The state machine (`recorderFlow.js`) is untouched.

This mirrors the discipline established by `recorderComposite.js` in v0.3: the canvas/rAF/Web-Worker plumbing is invisible to the rest of the app.

### Module shape

`openFloatingCam`:

1. Calls `window.documentPictureInPicture.requestWindow({ width, height, copyStyleSheets: true })`. Returns a `Window`.
2. In that window's `document.body`, mounts a `<video>` (mirrored via the existing `.cam-preview` rule from `styles.css` — copied over by `copyStyleSheets`) and a `<button class="primary">Stop</button>`.
3. Sets `<video>.srcObject = cameraStream` and calls `.play()` (`muted`, `playsInline`, `autoplay`).
4. Wires `button.addEventListener('click', () => { onStopClicked(); })`. Idempotent: a `clicked` flag guards against double-fire.
5. Wires `pipWindow.addEventListener('pagehide', () => { if (!closedByUs) onClosed?.(); })`. The `closedByUs` flag is set by the returned `close()` so manual close vs. programmatic close are distinguishable.
6. Returns `{ close }`. `close()` is idempotent: sets `closedByUs = true`, clears `<video>.srcObject`, calls `pipWindow.close()`. Safe to call after the window is already gone.

`isFloatingCamSupported`: trivial probe, no side effects.

## 7. Lifecycle and data flow

The bubble's lifecycle is bolted onto the existing `startCapture` / `releaseStream` ports in `recorder.js`. No SM changes.

### Start

In the existing `startCapture` port, after `composeStreams(...)` succeeds and the composite is wired into `capture.start(...)`:

```js
if (videoEnabled && cameraStream && isFloatingCamSupported()) {
  try {
    const handle = openFloatingCam({
      cameraStream,
      onStopClicked: () => dispatch({ type: 'StopClicked' }),
      onClosed: () => {
        floatingCamStop = null;
        restoreInPagePreview();
        ports.setStatus('Floating camera closed — recording continues.');
      },
    });
    floatingCamStop = handle.close;
    suspendInPagePreview();
  } catch {
    ports.setStatus('Floating camera unavailable — recording continues without overlay.');
    // floatingCamStop stays null; in-page preview stays visible.
  }
}
```

`floatingCamStop` is a module-local handle in `recorder.js`, mirroring the existing `composeStop` exactly.

### Stop

In the existing `releaseStream` port, alongside `composeStop`:

```js
if (floatingCamStop) {
  floatingCamStop();
  floatingCamStop = null;
}
```

After `composeStop` and before `capture.release()` — order doesn't strictly matter (both are idempotent and operate on independent resources), but grouping the two "things that opened from inside startCapture" reads cleanly.

`restoreInPagePreview()` is also called here so the preview reappears whether the bubble was closed manually or programmatically.

### In-page preview suspension

Two new helpers in `recorder.js`:

- `suspendInPagePreview()`: hides both `cam-preview-wrap` and `cam-preview-hidden`, sets a `previewSuspended` flag.
- `restoreInPagePreview()`: clears `previewSuspended`, then re-applies the visibility rule from the existing `previewVisible` flag (`previewVisible ? show wrap : show hidden-placeholder`).

The `turnCameraOn` / `turnCameraOff` / `cam-preview-toggle` / `cam-preview-show` handlers respect `previewSuspended` and do nothing visible while it's set. This avoids the existing `[hidden]` toggling logic from #18 fighting our suspension.

### Camera-track-end during recording

The existing `composite.onCameraEnded(...)` callback already updates the status text. We extend the same callback to also call `floatingCamStop?.()` and null it out. The bubble closes; the in-page preview reappears via `restoreInPagePreview` (which would otherwise still be useful), and the recording continues screen-only — all consistent with v0.3 §5's "continue without camera" rule.

## 8. User-activation timing

`documentPictureInPicture.requestWindow()` requires transient user activation. The click that triggered Start has flowed through `getDisplayMedia` (and possibly `getUserMedia` for the mic) before reaching `startCapture`. **Risk:** activation may have been consumed.

**Plan A (the design above):** rely on Chromium preserving transient activation across these awaits. In current Chromium this works in practice for the same flow Loom uses. Implementation should verify against current Chrome before merge.

**Plan B (fallback if A fails):** open the PIP window from the click handler in `recorder.js` (before `dispatch`), then pass the opened `Window` into `openFloatingCam` as a new optional `pipWindow` arg. The window opens early, sits empty for the duration of the screen-share picker, and gets populated once the camera stream is in hand. Worst case: user picks a source, sees a blank floating window for ~50ms before the video appears. Cost: one extra arg threaded through, plus owning a "didn't-actually-need-it" cleanup if the user denies the screen share.

We design for Plan A and keep Plan B in our pocket. The decision is empirical, made during implementation.

## 9. Adapter wiring summary

| Hook in `recorder.js` | Change |
| --- | --- |
| Module-load | Import `isFloatingCamSupported`, `openFloatingCam` from new module. Run probe; if unsupported, prepare the note element. |
| `cam-enabled` change handler (camera on) | Additionally: if probe was negative, unhide `cam-pip-note`. |
| `cam-enabled` change handler (camera off) | Additionally: if probe was negative, hide `cam-pip-note`. |
| `startCapture` port | After `composeStreams`, open floating cam (per §7). Suspend in-page preview. |
| `releaseStream` port | Close floating cam (per §7). Restore in-page preview. |
| `composite.onCameraEnded` callback | Also close floating cam. |

The `recorderFlow.js` reducer, `recorderEffects.js`, `recorderCapture.js`, `recorderUpload.js`, `recorderComposite.js`, and the entire server are untouched.

## 10. Module diff summary

| File | Change |
| --- | --- |
| `app/src/public/recorderFloatingCam.js` | **NEW** — Document PIP lifecycle module. |
| `app/src/public/recorder.js` | Capability probe at boot; `floatingCamStop` handle; suspend/restore preview helpers; wiring in `startCapture` / `releaseStream` / `onCameraEnded`. |
| `app/src/public/index.html` | Add `<p id="cam-pip-note" class="note" hidden>…</p>` below the toggle row. |
| `app/src/public/styles.css` | Add `.note` rule. The bubble's `<video>` reuses the existing `.cam-preview` rule via `copyStyleSheets`. |

No changes to `recorderFlow.js`, `recorderEffects.js`, `recorderCapture.js`, `recorderComposite.js`, `recorderUpload.js`, or any server-side file. No schema migration. No new mime types.

## 11. Testing strategy

### `recorderFloatingCam.js` — no unit tests

The vitest environment is `node` and the project explicitly holds the "no jsdom, no Playwright" line (v0.3 §10). `recorderFloatingCam.js` is DOM-coupled in exactly the way `recorderComposite.js` was — it touches `window.documentPictureInPicture`, builds DOM, wires `EventTarget` listeners. Following the v0.3 precedent set for `recorderComposite.js`, this module has no unit tests; correctness is verified by the manual smoke matrix below.

The module's surface is small (one factory function returning `{ close }`, plus a one-line probe), and its logic is "open a window, mount a `<video>` and a button, wire two listeners" — well within the manual-smoke-test budget.

### `recorder.js`, `recorderFlow.js`, the rest — no test changes

`recorder.js` stays untested per its own header comment ("intentionally untested; the testable seams sit in the modules it composes"). `recorderFlow.js` is unchanged. No existing test file needs to change.

### Manual smoke matrix (run before merge)

1. Chrome desktop, camera on → Start → tab away → bubble visible & live → click Stop in bubble → recording uploads → playback shows camera in bottom-left.
2. Chrome desktop, camera on → Start → close bubble manually mid-recording → status: "Floating camera closed — recording continues." → in-page preview reappears → click Stop on Mool tab → recording uploads correctly.
3. Chrome desktop, camera off → Start → no bubble appears → recording is screen-only (regression check on v0.3 path).
4. Firefox desktop → toggle camera on → note becomes visible → Start works → recording uploads with camera composited in the saved file (just no live overlay).
5. Safari desktop → same as Firefox.
6. Chrome desktop, camera on, mid-recording: revoke camera permission via browser UI (or unplug USB cam) → status: "Camera disconnected — continuing with screen only." → bubble closes → in-page preview reappears → recording continues screen-only → Stop on Mool tab → upload OK.
7. Chrome desktop, camera on, on a system where Document PIP is policy-blocked (test by stubbing `requestWindow` to reject in devtools): Start → status: "Floating camera unavailable — recording continues without overlay." → in-page preview stays visible → recording proceeds normally → Stop → upload OK.

## 12. Risks & mitigations

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| Transient activation gone by the time `requestWindow()` is called (Plan A fails) | Medium | Bubble never opens, error path always taken | Plan B: pre-open from click handler. Decided at implementation time. |
| `copyStyleSheets: true` doesn't pick up `styles.css` (e.g. if it's loaded oddly) | Low | Bubble looks unstyled (still functional) | Inline a minimal style block into the bubble's document as a backup. |
| Bubble visible during the brief gap between `requestWindow()` resolving and `<video>` painting its first frame | Medium | Black/empty bubble for ~50–200ms | Acceptable. If it's visibly bad, set `body` background to match the in-page preview's background colour so the gap reads as "loading," not "broken." |
| User opens a PIP window for some other site, then starts Mool: only one Document PIP window per document, but cross-document is fine | Low | None expected | Document PIP is per-document. Mool's bubble is independent of any other site's PIP. |
| Stop button click races with a Stop click on the Mool tab | Low | Two `StopClicked` dispatches | The SM already handles repeated `StopClicked` gracefully (transitions out of `Capturing` are guarded). The bubble's own `clicked` flag suppresses a second fire from the bubble. |
| Bubble persists if the Recorder page is closed/refreshed mid-recording | Low | Bubble closes anyway (window is owned by the now-gone document); MediaRecorder also dies | No special handling needed — same constraint as v0.3. |

## 13. Out of scope, deferred

- **Elapsed timer in the bubble.** Add only if a real user asks. Stop button is the load-bearing control.
- **Non-Chromium fallback via `window.open`.** Considered; the polish gap and the maintenance cost don't justify it for this project's audience.
- **Resizing / repositioning the bubble programmatically.** OS handles it.
- **Bubble during pre-recording framing** (open on camera-toggle-on instead of recording-start). The in-page preview already covers framing while the user is on the Mool tab; the bubble's value is specifically "after I've tabbed away."
- **Bubble for other surfaces** (mic-level meter, screen thumbnail, etc.). Issue #20 is about the camera; the rest is feature creep.
