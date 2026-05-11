/**
 * Adapter for the Recorder page. Wires DOM events into the pure state
 * machine (`recorderFlow.js`) and delegates effect execution to
 * `recorderEffects.js`. Real implementations of every side-effect door
 * (DOM mutations, the timer, `navigator.clipboard`, the `Capture`, the
 * HTTP layer) are constructed here and passed in as `ports`.
 *
 * The capture lifecycle (MediaRecorder, MediaStream cleanup, chunks→Blob,
 * the getDisplayMedia/getUserMedia error normalisation) lives in
 * `recorderCapture.js`. The HTTP layer (mintUpload / putBytes) lives in
 * `recorderUpload.js` (ADR-0007). The SM→ports dispatcher lives in
 * `recorderEffects.js`. This file is the only place that touches the DOM,
 * the timer interval, or `navigator.clipboard` — and it is intentionally
 * untested; the testable seams sit in the modules it composes.
 *
 * @typedef {import('./recorderFlow.js').State} State
 * @typedef {import('./recorderFlow.js').Event} FlowEvent
 */
import { initialState, transition } from './recorderFlow.js';
import {
  mintUpload as mintUploadRequest,
  putBytes as putBytesRequest,
} from './recorderUpload.js';
import { createCapture } from './recorderCapture.js';
import { runEffect } from './recorderEffects.js';
import { composeStreams } from './recorderComposite.js';
import { isFloatingCamSupported, openFloatingCam } from './recorderFloatingCam.js';

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const resultEl = document.getElementById('result');
const linkEl = document.getElementById('share-link');
const copyBtn = document.getElementById('copy');
const micToggleEl = document.getElementById('mic-enabled');
const camToggleEl = /** @type {HTMLInputElement} */ (document.getElementById('cam-enabled'));
const camPreviewWrap = /** @type {HTMLElement} */ (document.getElementById('cam-preview-wrap'));
const camPreviewHidden = /** @type {HTMLElement} */ (document.getElementById('cam-preview-hidden'));
const camPreviewVideo = /** @type {HTMLVideoElement} */ (document.getElementById('cam-preview'));
const camPreviewToggleBtn = /** @type {HTMLButtonElement} */ (document.getElementById('cam-preview-toggle'));
const camPreviewShowBtn = /** @type {HTMLButtonElement} */ (document.getElementById('cam-preview-show'));
const camPipNote = /** @type {HTMLElement} */ (document.getElementById('cam-pip-note'));

const floatingCamSupported = isFloatingCamSupported();

/** @type {State} */
let state = initialState();

/** @type {MediaStream | null} */
let cameraStream = null;
let previewVisible = true;
let previewSuspended = false;
let camGen = 0;

/**
 * Cancellation handle for the active canvas composite. Captured in
 * startCapture() when videoEnabled && cameraStream, consumed in
 * releaseStream() before capture.release() and nulled. Null otherwise
 * (camera-off recording, or before any recording has started).
 * @type {(() => void) | null}
 */
let composeStop = null;

/**
 * Cancellation handle for the active floating-camera overlay. Captured in
 * startCapture() when videoEnabled && cameraStream && floatingCamSupported,
 * consumed in releaseStream() before capture.release() (and also by the
 * onCameraEnded callback, see below), and nulled. Null otherwise.
 * @type {(() => void) | null}
 */
let floatingCamStop = null;

const capture = createCapture({
  navigator,
  MediaRecorderCtor: MediaRecorder,
});

/** @type {ReturnType<typeof setInterval> | null} */
let timerInterval = null;
let timerStartedAt = 0;

/** @type {import('./recorderEffects.js').Ports} */
const ports = {
  setStatus(message) {
    statusEl.textContent = message;
  },
  setButtons({ startEnabled, stopEnabled }) {
    startBtn.disabled = !startEnabled;
    stopBtn.disabled = !stopEnabled;
    // Both toggles are enabled exactly when Start is enabled — both gate
    // on "fresh capture is allowed" (Idle/Done/Failed).
    micToggleEl.disabled = !startEnabled;
    camToggleEl.disabled = !startEnabled;
  },
  startTimer() {
    timerStartedAt = Date.now();
    timerInterval = setInterval(() => {
      timerEl.textContent = formatElapsed(Date.now() - timerStartedAt);
    }, 200);
  },
  stopTimer() {
    if (timerInterval !== null) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  },
  showResult(viewerUrl) {
    linkEl.href = viewerUrl;
    linkEl.textContent = viewerUrl;
    resultEl.hidden = false;
  },
  hideResult() {
    resultEl.hidden = true;
  },
  async copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy link'), 1500);
    } catch {
      /* clipboard unavailable — silent */
    }
  },
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
  requestDisplay: () => capture.requestDisplay(),
  requestUser: () => capture.requestUser(),
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
  stopCapture: () => capture.stop(),
  mintUpload: ({ mimeType, sizeBytes }) =>
    mintUploadRequest({ fetch, mimeType, sizeBytes }),
  putBytes: ({ uploadUrl, blob, mimeType }) =>
    putBytesRequest({ fetch, uploadUrl, blob, mimeType }),
  dispatch: (event) => dispatch(event),
};

/** @param {FlowEvent} event */
function dispatch(event) {
  const result = transition(state, event);
  state = result.next;
  for (const eff of result.effects) {
    runEffect(eff, ports);
  }
}

/** @param {number} ms */
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

startBtn.addEventListener('click', () =>
  dispatch({ type: 'StartClicked', audioEnabled: micToggleEl.checked, videoEnabled: camToggleEl.checked }),
);
stopBtn.addEventListener('click', () => dispatch({ type: 'StopClicked' }));
copyBtn.addEventListener('click', () => dispatch({ type: 'CopyClicked' }));

camToggleEl.addEventListener('change', async () => {
  if (camToggleEl.checked) {
    await turnCameraOn();
  } else {
    turnCameraOff();
  }
});

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
 * `previewVisible` (which is unchanged across suspend/restore). If the
 * camera was turned off during suspension, clears the flag but skips DOM
 * updates (nothing to show).
 */
function restoreInPagePreview() {
  if (!previewSuspended) return;
  // Clear flag before the cameraStream guard — restore is "no longer
  // suspended" regardless of whether the DOM gets touched.
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

async function turnCameraOn() {
  const myGen = ++camGen;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    if (myGen === camGen) {
      showCamFailure(
        'Camera API unavailable. The page must be served over https or http://localhost — check your URL.',
      );
    }
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
  } catch (err) {
    if (myGen !== camGen) return;
    const name = err && err.name ? err.name : 'Error';
    let message;
    if (name === 'NotFoundError') {
      message = 'No camera found. Recording will be screen-only.';
    } else if (name === 'NotAllowedError' || name === 'SecurityError') {
      message = 'Camera access denied. Allow it in your browser, or leave the camera off.';
    } else {
      const detail = err && err.message ? err.message : String(err);
      message = `Camera error: ${name} — ${detail}`;
    }
    showCamFailure(message);
    return;
  }

  if (myGen !== camGen || !camToggleEl.checked) {
    // User toggled away (or rapid on→off→on) while we were awaiting the
    // permission prompt. Release the stream we just got — we don't own it.
    // camPipNote needs no reset here: turnCameraOff (or showCamFailure)
    // ran during the await and already hid it.
    stream.getTracks().forEach((t) => t.stop());
    return;
  }

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

/**
 * Bounce the toggle back to off and surface the failure message.
 * Does not affect any other state — the SM is not involved.
 *
 * @param {string} message
 */
function showCamFailure(message) {
  camToggleEl.checked = false;
  cameraStream = null;
  camPreviewVideo.srcObject = null;
  camPreviewWrap.hidden = true;
  camPreviewHidden.hidden = true;
  camPipNote.hidden = true;
  ports.setStatus(message);
}
