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

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const resultEl = document.getElementById('result');
const linkEl = document.getElementById('share-link');
const copyBtn = document.getElementById('copy');
const micToggleEl = document.getElementById('mic-enabled');

/** @type {State} */
let state = initialState();

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
    // The mic toggle is enabled exactly when Start is enabled — both are
    // gated on "fresh capture is allowed" (Idle/Done/Failed).
    micToggleEl.disabled = !startEnabled;
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
    capture.release();
  },
  requestDisplay: () => capture.requestDisplay(),
  requestUser: () => capture.requestUser(),
  startCapture(stream, audioStream, onTrackEnded) {
    capture.start(stream, audioStream);
    // Either track ending (screen or mic) flows through Stopping.
    // TrackEnded outside Capturing is a no-op (see recorderFlow.js).
    // Iterate AFTER start() so the merged audio tracks are included.
    for (const track of stream.getTracks()) {
      track.onended = onTrackEnded;
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
  dispatch({ type: 'StartClicked', audioEnabled: micToggleEl.checked }),
);
stopBtn.addEventListener('click', () => dispatch({ type: 'StopClicked' }));
copyBtn.addEventListener('click', () => dispatch({ type: 'CopyClicked' }));
