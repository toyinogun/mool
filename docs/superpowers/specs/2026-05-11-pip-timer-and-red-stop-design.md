# PiP timer and red stop button design

**Date:** 2026-05-11
**Status:** Approved design, pending implementation plan
**Project root:** `/home/toyin/mool`
**Builds on:** [`2026-05-11-live-camera-overlay-design.md`](./2026-05-11-live-camera-overlay-design.md) (the camera-only PiP shipped via PR #21)

## 1. Goal

While a camera-on recording is in progress, the PiP window should show the elapsed recording time and stop the recording with a button whose color matches the action it performs. Today the PiP shows only the live camera and a green "Stop" button — adequate but visually confused (green reads as a *start* affordance) and silent about how long the recording has been running.

This is the minimum visual upgrade to the existing camera PiP. It adds no new product features and changes no other surface.

## 2. Scope

### In scope

- A live elapsed-time readout inside the PiP window, between the camera circle and the Stop button.
- Recoloring the Stop button red to match its semantics.
- Bumping the PiP window's default height to accommodate the timer without crowding.

### Explicitly out of scope

- Opening the PiP when the camera is off. PiP remains camera-conditional, same as today.
- A pulsing recording indicator next to the timer. The camera and red Stop carry the "live" signal.
- Cross-browser parity. Firefox / Safari users still get no PiP and no timer; the existing in-page note covers this.
- Pause, restart, mic mute, or any other controls inside the PiP.
- Any change to the in-page timer on the Mool tab.
- Any change to the recording pipeline, the composite, the upload path, or the viewer.

## 3. Visible behavior

| When | What the user sees in the PiP |
|---|---|
| Camera-on recording starts | PiP opens with the camera circle (unchanged), a `00:00` timer below it, and a red Stop button below the timer. |
| During recording | Timer ticks once per second, formatted `MM:SS`. |
| Recording stops (either Stop button) | PiP closes, same as today. |
| Camera off | No PiP. Same as today. |
| Firefox / Safari | No PiP. Existing in-page note covers this. |

Window dimensions: 240 wide, 320 tall (up from 280). The extra 40px holds the timer line plus its top/bottom padding.

Timer format mirrors the existing `formatElapsed(ms)` helper in `recorder.js` — `MM:SS`, padded to two digits, no hour rollover. Recording sessions over 60 minutes will display `60:00`, `61:00`, etc. Acceptable for v1; if a viewer ever complains we can extend the helper. The same format is already shown on the Mool tab.

## 4. Architecture

### Single source of truth for elapsed time

`recorder.js` already owns `timerStartedAt` (set when the recorder enters `Capturing`) and the in-page 1Hz interval that updates the Mool tab's `<span id="timer">`. The PiP timer reads from the same `timerStartedAt`. There are not two clocks — there are two displays of one clock.

### `recorderFloatingCam.js` changes

The module's public surface gains one optional argument:

```ts
openFloatingCam({
  cameraStream,
  onStopClicked,
  startedAt,            // NEW — Date.now() value when recording started
  onClosed,
  onError,
  width,
  height,
}): { close }
```

`populate(win)` is extended:

1. Append a `<div class="cam-timer">00:00</div>` between the `<video>` and the Stop button.
2. Add CSS rules for `.cam-timer` to the inlined `<style>` block (monospace, 18px, white, `font-variant-numeric: tabular-nums`).
3. Change `button.primary` in the same inlined `<style>` from green (`#2da44e`) to red (`#da3633`); hover from `#2c974b` to `#cf2c2c`. Border matches background.
4. Start a `setInterval(..., 1000)` *inside the PiP window's own `window`* that recomputes `Date.now() - startedAt` and writes the formatted string into the timer div. Format inline — duplicate the four-line `formatElapsed` rather than reaching across module boundaries to import it from `recorder.js`. The duplication is intentional (see §6).

The interval handle is captured in a `closure-local timerInterval`. `close()` clears it before closing the window. `pagehide` (manual-close path) also clears it as a defense in depth.

The default `height` argument changes from `280` to `320`. Width stays `240`.

### `recorder.js` changes

The existing call site for `openFloatingCam` passes one more argument: `startedAt: timerStartedAt`. No other changes — `recorder.js` does not reach into the PiP's DOM, does not own the PiP's interval, and does not need to know the timer element exists.

### Why duplicate `formatElapsed` instead of importing it

`recorderFloatingCam.js` is the boundary that owns the PiP window's DOM and styling — see its file-level docstring. It already duplicates colour values from `styles.css` for the same reason (`copyStyleSheets` is unreliable in Chrome). Pulling `formatElapsed` from `recorder.js` would require either exporting it (turning a recorder-page helper into a public-ish utility) or moving it to a shared module. Both are larger refactors than the value justifies for a four-line function. If a third caller ever needs it, extract then.

## 5. Files touched

| File | Change |
|---|---|
| `app/src/public/recorderFloatingCam.js` | Add `startedAt` param. Append `.cam-timer` div in `populate()`. Add CSS rules for the timer. Recolor the Stop button red. Add the 1s interval. Clear it in `close()` and on `pagehide`. Bump default `height` to 320. |
| `app/src/public/recorder.js` | One added arg in the call to `openFloatingCam`: `startedAt: timerStartedAt`. |
| `app/src/public/index.html` | **No change.** |
| `app/src/public/styles.css` | **No change.** PiP styles are inlined in the module. |
| `app/tests/*` | **No change.** See §7. |

No server-side changes. No schema migration. No new mime types.

## 6. Failure modes

| Trigger | Behavior |
|---|---|
| `requestWindow()` rejects | Same as today — log, surface via `onError`. No timer to clean up; the interval is created in `populate()` which never ran. |
| User closes PiP manually mid-recording | `pagehide` fires. The interval is cleared (defense in depth — `close()` clearing it is the primary path, but `pagehide` fires whether or not `close()` was the cause). The Mool tab's in-page timer keeps running independently. |
| Recording stops via Mool tab's Stop button | `close()` is called by `recorder.js`'s teardown. The interval is cleared, then the window is closed. |
| Recording stops via PiP's Stop button | `onStopClicked` dispatches `StopClicked` to the SM. The SM's teardown eventually calls `close()`. Same path as above. |
| Window suspended (laptop sleep, browser throttle) | `Date.now() - startedAt` self-corrects on the next tick. The user may see the timer jump on resume — acceptable, matches what the in-page timer already does. |
| `startedAt` is missing or zero | The timer reads `Date.now() - 0` and displays a huge number. This is a programmer error, not a user-visible failure mode — covered by the manual test that asserts the timer starts at `00:00`. |

### Deliberate non-failures

- **Drift between the PiP timer and the in-page timer.** Both read `Date.now() - timerStartedAt`. They tick on independent 1Hz intervals, so within any given second they may show different values briefly. Acceptable; nobody compares them side by side.
- **PiP window not yet populated when the user clicks Stop very quickly.** The Stop button on the Mool tab still works. The PiP's stop fires on the click handler attached in `populate()`, which can't fire before `populate()` runs. No race.

## 7. Testing

`recorderFloatingCam.js` is intentionally not unit-tested. Its file-level docstring (and its peer `recorder.js`'s) document the reasoning: it is the only place that touches `window.documentPictureInPicture` and builds the PiP's DOM; the testable seams live in the modules it composes with, not inside.

Manual test plan extension:

- [ ] Start a camera-on recording. The PiP opens with the camera and a `00:00` timer.
- [ ] After ~5 seconds, the PiP timer reads `00:05`, matching the in-page timer within ±1s.
- [ ] Recording continues for 1 minute. PiP timer reads `01:00`.
- [ ] Click Stop *inside the PiP*. PiP closes, recording stops, share link appears on the Mool tab.
- [ ] Start a new camera-on recording. Click Stop on the *Mool tab* instead. PiP closes, no console errors.
- [ ] Start a recording, manually close the PiP via its X button. Recording continues. No console errors; no devtools warning about a leaked interval.
- [ ] Stop button background is `#da3633` (red), hovers to `#cf2c2c`. Stop button text is still `Stop`.
- [ ] Camera-off recording. No PiP. No console errors. (Regression check.)
- [ ] Firefox / Safari: no PiP, in-page note visible. No console errors. (Regression check.)

## 8. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Leaked `setInterval` in the PiP window after a manual close path that doesn't go through `close()`. | Low | Memory growth across recordings | Defense in depth: clear the interval in both `close()` and `pagehide`. Manual test catches a regression here. |
| `formatElapsed` drifts between the two implementations as recorder.js evolves. | Low | Visual mismatch between the two timer displays | The PiP's copy is four lines of trivial logic. If `recorder.js`'s changes meaningfully, extract `formatElapsed` to a shared module then. Not preemptively. |
| The 240×320 window feels too tall for some users on small screens. | Low | Mild UX annoyance | The user can drag/resize the PiP window with native OS controls. Revisit only if reported. |

## 9. Open questions

None. All visual and architectural choices were resolved during brainstorming (scope picked as Option A — minimal upgrade; timer treatment picked as plain over pulsing dot).
