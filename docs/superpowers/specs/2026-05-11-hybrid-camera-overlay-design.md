# Hybrid live camera overlay design

Date: 2026-05-11
Builds on the PIP-only behavior shipped via [PR #21](https://github.com/toyinogun/mool/pull/21) and described in [`2026-05-11-live-camera-overlay-design.md`](./2026-05-11-live-camera-overlay-design.md). The PIP module (`recorderFloatingCam.js`) is unchanged; only the trigger conditions in `recorder.js` change.

## 1. Goal

Show the camera the right way for where the user is looking. While the user is on the Mool tab, show the existing clean in-page circle preview — no PIP window, no browser chrome. While the user is on any other tab or window, open a Document Picture-in-Picture bubble so the camera follows them. Switch dynamically as tab visibility changes.

This closes the polish gap with Loom's web recorder on the home tab while keeping the cross-tab follow that the PIP-only branch already provides.

## 2. Scope

### In scope

- A `visibilitychange` listener on `document`, registered for the duration of a camera-on recording on Chromium browsers.
- Open the floating PIP when the Mool tab is hidden; close it (programmatically) and restore the in-page preview when the Mool tab is visible.
- Manual close (user clicks the X on the PIP window) takes effect for the current hidden period only; the next time the user tabs away, a fresh PIP opens.
- Status messages clarifying what just happened ("Floating camera closed — will reopen next time you tab away.").

### Explicitly out of scope

- Pause / resume controls in the PIP. Separate feature; gated by [#19](https://github.com/toyinogun/mool/issues/19) (rAF-throttling fix) anyway.
- Timer in the PIP bubble.
- Camera / mic device pickers in the pre-recording UI.
- A fuller controls bar (restart, delete) inside the PIP.
- Hybrid for any control surface other than the camera bubble itself.
- Behavior on Firefox / Safari, beyond keeping today's behavior unchanged.

## 3. The rule

While a camera-on recording is in progress on Chromium:

| `document.visibilityState` transitions to | Action |
|---|---|
| `hidden` | If no PIP currently open, open one. Suspend in-page preview. |
| `visible` | If a PIP is currently open, close it (programmatically). Restore in-page preview. |

That is the entire decision surface. No flags, no debouncing, no first-time-only logic. The "manual close means reopen on next tab-switch" behavior falls out automatically: the PIP-open check sees no PIP, so the next `hidden` transition opens a fresh one.

Independence from the existing in-page **Hide preview / Show preview** toggle is intentional: that toggle controls page UI, not recording feedback. PIP opens when the user would otherwise be blind, regardless of `previewVisible`.

## 4. User flow

### Happy path on Chromium

1. User toggles camera on → in-page preview circle appears (unchanged).
2. User clicks Start → mic prompt → screen-share prompt → screen source picked.
3. Composite stream is built (`composeStreams`, unchanged).
4. **New:** `visibilitychange` listener registered. If `document.hidden` is already true (rare — happens when the screen-picker brought the user to a different window), open the PIP immediately and suspend in-page preview.
5. User tabs to the app they're recording → `hidden` → PIP opens, in-page preview suspended.
6. User tabs back to Mool to check progress → `visible` → PIP closes, in-page preview restored.
7. User tabs away again → `hidden` → fresh PIP opens.
8. User clicks Stop (in the PIP, in the Mool tab — same dispatch) → recording ends.
9. `releaseStream` tears down: remove the visibility listener, close the PIP if open, restore in-page preview, release composite + capture.

### Recording with camera off

Identical to v0.3. No PIP, no listener, no in-page preview to suspend.

### Firefox / Safari (no Document PIP)

Capability probe at boot is unchanged. The visibility listener is never registered. Net effect: identical to today — in-page preview when on Mool, nothing when off, camera still composited into the saved file.

### Manual close mid-recording

1. User is on a recorded tab; PIP is open.
2. User clicks X on the PIP window → `pagehide` fires → module-internal `closeRequested` flag is **not** set (this is a true manual close), so `onClosed` callback fires → `floatingCamStop` cleared and `restoreInPagePreview()` invoked in `recorder.js`. The restore has no visible effect right now (user is on a hidden tab) but leaves the in-page preview correctly visible for whenever the user returns.
3. Status: *"Floating camera closed — will reopen next time you tab away."*
4. User tabs back to Mool → `visible` → PIP-close-if-open is a no-op; `restoreInPagePreview` is also a no-op (already restored).
5. User tabs away again → `hidden` → PIP-open-if-closed sees no PIP, opens fresh.

## 5. Failure modes

| Trigger | When | Visible effect | Recording state |
|---|---|---|---|
| `documentPictureInPicture` missing | Boot, FF/Safari | Note appears when camera toggle is on (existing v0.3 behavior); recording still works | Recording proceeds, no listener, no PIP |
| `requestWindow()` rejects | On any `hidden` transition that tries to open PIP | Status: "Floating camera unavailable — recording continues without overlay." In-page preview is restored (in case user is back on Mool by then). | `Capturing` continues. The visibility listener stays alive — the next `hidden` retries `requestWindow`, since denial reasons can be transient. |
| Camera track ends mid-recording (USB unplug, etc.) | During `Capturing` | v0.3 status ("Camera disconnected — continuing with screen only") **plus** the PIP closes if open | `Capturing` continues, screen-only. The visibility listener stays alive but `openFloatingCamIfClosed` skips early because `cameraStream` is null. |
| Stop button in the PIP clicked while SM is past `Capturing` (in flight: stopping/uploading) | During `Stopping` / `MintingUrl` / `Uploading` | Click is a no-op. The PIP's close is driven by `releaseStream`, not by the Stop button. | Unchanged. |
| Rapid tab-flicks (visible → hidden → visible faster than `requestWindow` resolves) | During `Capturing` | Brief in-page-preview flash between transitions, then settles to whatever the latest visibility is | Unchanged. The module's existing `closeRequested` flag disposes any window that resolves after `close()` was called. |

### Deliberate non-failures

- **`requestWindow` rejected because the user is on Mool tab.** Some browsers gate `requestWindow` on user activation. Since our open is triggered by `visibilitychange`, not a click, it's allowed (Document PIP doesn't currently require user activation; if that changes, the failure mode above covers it gracefully).
- **PIP open while screen-share picker is showing.** `getDisplayMedia`'s picker is a separate system overlay; it doesn't change `visibilityState`. We don't open PIP during the picker. The first `hidden` transition after picking handles the open.

## 6. Architecture

The PIP module (`recorderFloatingCam.js`) is **unchanged**. Its existing surface — `openFloatingCam({ cameraStream, onStopClicked, onClosed, onError })` returning `{ close }`, with `closeRequested` distinguishing manual close from programmatic — already supports being called more than once per recording.

All the new logic lives in `recorder.js`:

- **State:** keep the existing module-locals (`floatingCamStop`, `previewSuspended`, `previewVisible`, `cameraStream`, `floatingCamSupported`). No new module-locals required, except a handle to the visibility listener so it can be removed.
- **Helpers:**
  - `setupVisibilityHandling()` — adds the `visibilitychange` listener.
  - `teardownVisibilityHandling()` — removes it.
  - `openFloatingCamIfClosed()` — guards on `floatingCamStop` and `cameraStream`, then runs the existing `openFloatingCam(...)` wiring (lifted from the current inline block in `startCapture`). The `onClosed` callback (manual close) calls `restoreInPagePreview()` unconditionally — see the manual-close flow above for why.
  - `closeFloatingCamIfOpen()` — if `floatingCamStop` is set, calls it and clears the handle. Always calls `restoreInPagePreview()` afterward, even if there was no PIP to close, so a `visible` transition after a manual close is also self-healing.
- **`startCapture` port** invokes `setupVisibilityHandling()` after `composeStop` is set, then opens immediately if `document.hidden`. The existing inline `openFloatingCam(...)` block is replaced by a call into `openFloatingCamIfClosed()`.
- **`releaseStream` port** invokes `teardownVisibilityHandling()` and `closeFloatingCamIfOpen()` before `capture.release()`. The existing `composeStop()` call is unchanged.

### Why not extract into a new module

The new code is ~40–50 lines of glue around two existing modules (`recorderFloatingCam`, the in-page preview suspend/restore helpers). Extracting it into a `recorderHybridCam.js` would bury its dependencies on `cameraStream`, `previewSuspended`, the dispatch port, and the status port behind another seam, without making the logic clearer. Keep it in `recorder.js` next to the related plumbing.

## 7. Files touched

| File | Change |
|---|---|
| `app/src/public/recorder.js` | Add visibility listener + helpers. Refactor existing inline `openFloatingCam` call to go through `openFloatingCamIfClosed`. Wire `releaseStream` to tear down listener and close PIP via `closeFloatingCamIfOpen`. |
| `app/src/public/recorderFloatingCam.js` | **No change.** |
| `app/src/public/index.html` | **No change.** |
| `app/src/public/styles.css` | **No change.** |
| `app/tests/recorderFlow.test.ts`, `app/tests/recorderEffects.test.ts` | **No change.** Hybrid behavior is glue in the adapter, not the SM or effect dispatcher. |

No changes to `recorderFlow.js`, `recorderEffects.js`, `recorderCapture.js`, `recorderComposite.js`, `recorderUpload.js`, or any server-side file. No schema migration. No new mime types.

## 8. Testing

`recorder.js` is intentionally untested in the existing architecture — its file-level docstring spells out the reasoning (it is the only place that touches the DOM, the timer interval, or `navigator.clipboard`; the testable seams sit in the modules it composes). The hybrid logic adds no new branchy logic to test exhaustively; it's a thin reactive wrapper.

Manual test plan covers the user-visible matrix:

- [ ] Camera on, start recording, stay on Mool tab. In-page bubble visible. No PIP window.
- [ ] Tab away. Within ~300ms, PIP appears with the camera. In-page bubble gone from Mool tab.
- [ ] Tab back to Mool. PIP closes. In-page bubble reappears.
- [ ] Tab away again. Fresh PIP opens.
- [ ] Tab away, click X on PIP. PIP gone, recording continues, status shows the "will reopen" message.
- [ ] Tab back to Mool. In-page bubble reappears (no PIP to close).
- [ ] Tab away again. Fresh PIP opens (manual close didn't make it permanent).
- [ ] Click Stop in the PIP from a recorded tab. Recording stops; share link appears on Mool tab.
- [ ] Click Stop on the Mool tab while PIP is open in another window. Recording stops; PIP closes.
- [ ] Camera off, full recording cycle. No listener registered, no PIP, no behavior change.
- [ ] Firefox / Safari: in-page bubble while on Mool, nothing while off, camera still in saved file. No console errors.
- [ ] Rapid tab-flick (cmd-tab repeatedly during recording). No console errors. PIP either open or closed, never stuck "opening."

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `requestWindow` is called many times per recording. Browsers may rate-limit or accumulate state. | Low | PIP fails to open after some threshold | If observed, debounce or cap retries per recording. Not preemptively. |
| Each PIP open resets the window position to the OS default. User who drags the window somewhere loses that position on next tab-switch. | Medium | Mild UX annoyance | Accepted. Most recording sessions involve few tab-switches; rebuild only if users complain. The alternative (keep PIP open, hide in-page bubble) loses the polish goal entirely. |
| `visibilitychange` fires for non-tab transitions (e.g., entire browser window minimized) and opens PIP unexpectedly. | Low | PIP appears when user minimizes the browser, then disappears when restored. | Accepted. The semantic ("Mool tab not visible to user") is correct; the user just gets a slightly noisier PIP lifecycle on uncommon edge cases. |
| Race: `requestWindow` resolves AFTER `close()` is called by a `visible` transition. | Low | Spurious PIP window flashes briefly | The module's existing `closeRequested` flag disposes the late-arriving window on resolution. No code change required. |
| Hybrid ships before the [#20](https://github.com/toyinogun/mool/issues/20) styling fix lands. The polished in-page bubble would swap to an over-zoomed PIP when the user tabs away — UX *worse* than the polish goal. | Resolved | — | The styling fix landed in commit `3d208b1` (inline `<style>` block in the bubble's `<head>`, camera sized 200×200 for the larger floating window). No remaining dependency. |

## 10. Open questions

None at design time. All three branching decisions (close-on-visible vs keep-open, manual-close-reopens vs stays-closed, hide-preview-suppresses-PIP vs independent) were resolved with the user during brainstorming.

## 11. Postscript — design abandoned (2026-05-11)

**This design is not viable in pure browser. Do not re-implement.**

The implementation was built on branch `spec/hybrid-camera-overlay` (commits `6272f23` → `d660e18`, never merged) and smoke-tested on Chromium. The first `visibilitychange → hidden` opened the PIP correctly, but the second tab-away (after returning to the Mool tab) failed with:

```
NotAllowedError: Failed to execute 'requestWindow' on 'DocumentPictureInPicture':
Document PiP requires user activation
```

`documentPictureInPicture.requestWindow()` requires fresh **user activation** (a recent click/tap/keypress, ~5 second window in Chromium). The Start-recording click satisfied this for the first programmatic open, but visibility transitions are not user activations and cannot prime the API. Every subsequent visibility-driven open will fail the same way. The §5 "Deliberate non-failures" claim in this spec — "Document PIP doesn't currently require user activation" — was wrong.

This means the strict-hybrid behavior (open on `hidden`, close on `visible`, repeat) cannot be implemented in pure browser. The polish goal (clean in-page bubble while on Mool, PIP-with-chrome only when off-tab) is unreachable from a pure web app.

Reasonable alternatives, not pursued here:

- **Lazy hybrid** (open once on first `hidden`, never close until recording ends): degraded polish but only opens PIP when needed. Still requires the user to tab away within Start's activation window (~5s) or even the first open fails.
- **Manual "Pop out camera" button** on the Mool tab: a click is fresh activation, so the button always works. Less automatic than Loom-style behavior but reliable.
- **Browser extension wrapper** for Mool: extensions can inject overlay UI into any page without the user-activation gate. Out of scope for v0.x.

The currently-shipped behavior on `main` (PR #21: PIP always open during camera-on recording, opened by the Start click that has guaranteed activation) is the only reliable approach in pure browser today and is what Mool ships.

If a future browser change relaxes the user-activation requirement on `documentPictureInPicture.requestWindow`, this design becomes implementable as written. Until then, leave it.
