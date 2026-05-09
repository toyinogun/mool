/**
 * Adapter for the Recorder page. Wires DOM events into the pure state
 * machine (`recorderFlow.js`) and executes the effects the SM emits.
 *
 * The capture lifecycle (MediaRecorder, MediaStream cleanup, chunks→Blob,
 * the getDisplayMedia/getUserMedia error normalisation) lives in
 * `recorderCapture.js` (ADR-0009 sibling extraction). The HTTP layer
 * (mintUpload / putBytes) lives in `recorderUpload.js` (ADR-0007). This
 * file is the only place that touches the DOM, the timer interval, or
 * `navigator.clipboard`.
 *
 * @typedef {import('./recorderFlow.js').State} State
 * @typedef {import('./recorderFlow.js').Event} FlowEvent
 * @typedef {import('./recorderFlow.js').Effect} Effect
 */
import { initialState, transition } from './recorderFlow.js';
import {
  mintUpload as mintUploadRequest,
  putBytes as putBytesRequest,
} from './recorderUpload.js';
import { createCapture } from './recorderCapture.js';

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

/** @param {FlowEvent} event */
function dispatch(event) {
  const result = transition(state, event);
  state = result.next;
  for (const eff of result.effects) {
    runEffect(eff);
  }
}

/** @param {Effect} eff */
function runEffect(eff) {
  switch (eff.type) {
    case 'requestDisplayMedia':
      requestDisplay();
      return;
    case 'requestUserMedia':
      requestUser();
      return;
    case 'startRecording':
      startCapture(eff.stream, eff.audioStream);
      return;
    case 'stopRecording':
      stopCapture();
      return;
    case 'releaseStream':
      capture.release();
      return;
    case 'mintUpload':
      mintUpload(eff.mimeType, eff.sizeBytes);
      return;
    case 'putBytes':
      putBytes(eff.uploadUrl, eff.blob, eff.mimeType);
      return;
    case 'setStatus':
      statusEl.textContent = eff.message;
      return;
    case 'setButtons':
      startBtn.disabled = !eff.startEnabled;
      stopBtn.disabled = !eff.stopEnabled;
      // The mic toggle is enabled exactly when Start is enabled — both
      // are gated on "fresh capture is allowed" (Idle/Done/Failed).
      micToggleEl.disabled = !eff.startEnabled;
      return;
    case 'startTimer':
      timerStartedAt = Date.now();
      timerInterval = setInterval(() => {
        timerEl.textContent = formatElapsed(Date.now() - timerStartedAt);
      }, 200);
      return;
    case 'stopTimer':
      if (timerInterval !== null) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      return;
    case 'showResult':
      linkEl.href = eff.viewerUrl;
      linkEl.textContent = eff.viewerUrl;
      resultEl.hidden = false;
      return;
    case 'hideResult':
      resultEl.hidden = true;
      return;
    case 'copyToClipboard':
      copyToClipboard(eff.text);
      return;
  }
}

async function requestDisplay() {
  const r = await capture.requestDisplay();
  if (r.kind === 'ok') {
    dispatch({ type: 'DisplayMediaGranted', stream: r.stream });
  } else {
    dispatch({ type: 'DisplayMediaFailed', reason: r.reason });
  }
}

async function requestUser() {
  const r = await capture.requestUser();
  if (r.kind === 'ok') {
    dispatch({ type: 'UserMediaGranted', stream: r.stream });
  } else {
    dispatch({ type: 'UserMediaFailed', reason: r.reason });
  }
}

/**
 * @param {MediaStream} stream
 * @param {MediaStream | undefined} audioStream
 */
function startCapture(stream, audioStream) {
  capture.start(stream, audioStream);
  // Either track ending (screen or mic) flows through Stopping.
  // TrackEnded outside Capturing is a no-op (see recorderFlow.js).
  // Iterate AFTER start() so the merged audio tracks are included.
  for (const track of stream.getTracks()) {
    track.onended = () => dispatch({ type: 'TrackEnded' });
  }
}

async function stopCapture() {
  const { blob, mimeType } = await capture.stop();
  dispatch({ type: 'RecorderStopped', blob, mimeType });
}

/**
 * @param {string} mimeType
 * @param {number} sizeBytes
 */
async function mintUpload(mimeType, sizeBytes) {
  const r = await mintUploadRequest({ fetch, mimeType, sizeBytes });
  if (r.kind === 'ok') {
    dispatch({
      type: 'CreateOk',
      slug: r.slug,
      uploadUrl: r.uploadUrl,
      viewerUrl: r.viewerUrl,
    });
  } else {
    dispatch({ type: 'CreateFailed', reason: r.reason });
  }
}

/**
 * @param {string} uploadUrl
 * @param {Blob} blob
 * @param {string} mimeType
 */
async function putBytes(uploadUrl, blob, mimeType) {
  const r = await putBytesRequest({ fetch, uploadUrl, blob, mimeType });
  if (r.kind === 'ok') {
    dispatch({ type: 'PutOk' });
  } else {
    dispatch({ type: 'PutFailed', reason: r.reason });
  }
}

/** @param {string} text */
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy link'), 1500);
  } catch {
    /* clipboard unavailable — silent */
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
