/**
 * Adapter for the Recorder page. Wires DOM events into the pure state
 * machine (`recorderFlow.js`) and executes the effects the SM emits.
 *
 * This file is the only place that touches the DOM, `MediaRecorder`,
 * `setInterval`, or `navigator.clipboard`. The HTTP layer (mintUpload /
 * putBytes against /create-upload and R2) lives in `recorderUpload.js`
 * and is tested independently against a fake fetch.
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

/** @type {MediaRecorder | null} */
let mediaRecorder = null;
/** @type {MediaStream | null} */
let activeStream = null;
/** @type {MediaStream | null} */
let activeAudioStream = null;
/** @type {Blob[]} */
let chunks = [];
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
      requestDisplayMedia();
      return;
    case 'requestUserMedia':
      requestUserMedia();
      return;
    case 'startRecording':
      startRecording(eff.stream, eff.audioStream);
      return;
    case 'stopRecording':
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
      }
      return;
    case 'releaseStream':
      if (activeStream) {
        activeStream.getTracks().forEach((t) => t.stop());
        activeStream = null;
      }
      if (activeAudioStream) {
        activeAudioStream.getTracks().forEach((t) => t.stop());
        activeAudioStream = null;
      }
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

async function requestDisplayMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    dispatch({
      type: 'DisplayMediaFailed',
      reason:
        'getDisplayMedia is unavailable. The page must be served over https or http://localhost — check your URL.',
    });
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
  } catch (err) {
    const name = err && err.name ? err.name : 'Error';
    const message = err && err.message ? err.message : String(err);
    dispatch({ type: 'DisplayMediaFailed', reason: `${name} — ${message}` });
    return;
  }
  dispatch({ type: 'DisplayMediaGranted', stream });
}

async function requestUserMedia() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    dispatch({
      type: 'UserMediaFailed',
      reason:
        'Microphone API unavailable. The page must be served over https or http://localhost — check your URL.',
    });
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    const name = err && err.name ? err.name : 'Error';
    let message;
    if (name === 'NotFoundError') {
      message = 'No microphone found. Turn off the mic toggle to record silently.';
    } else if (name === 'NotAllowedError' || name === 'SecurityError') {
      message =
        'Microphone access denied. Allow it in your browser, or turn off the mic toggle to record silently.';
    } else {
      const detail = err && err.message ? err.message : String(err);
      message = `Microphone error: ${name} — ${detail}`;
    }
    dispatch({ type: 'UserMediaFailed', reason: message });
    return;
  }
  // Hold the stream in adapter state so releaseStream can clean it up
  // even if the screen-share prompt is denied (no startRecording yet).
  activeAudioStream = stream;
  dispatch({ type: 'UserMediaGranted', stream });
}

/**
 * @param {MediaStream} stream
 * @param {MediaStream | undefined} audioStream
 */
function startRecording(stream, audioStream) {
  activeStream = stream;
  activeAudioStream = audioStream ?? null;

  // Merge mic audio into the screen stream so a single MediaRecorder
  // produces one container with both video and audio tracks.
  if (audioStream) {
    for (const track of audioStream.getAudioTracks()) {
      stream.addTrack(track);
    }
  }

  chunks = [];
  const mimeType = pickMimeType(Boolean(audioStream));
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    // Use the mime type we passed to the MediaRecorder constructor — that's
    // what's pinned in ALLOWED_MIME server-side. The browser's
    // mediaRecorder.mimeType may normalize codec ordering or add quoting,
    // and the server's allow-list does exact-string comparison.
    const blob = new Blob(chunks, { type: mimeType });
    dispatch({ type: 'RecorderStopped', blob, mimeType });
  };
  // Either track ending (screen or mic) flows through Stopping.
  // TrackEnded outside Capturing is a no-op (see recorderFlow.js).
  for (const track of stream.getTracks()) {
    track.onended = () => dispatch({ type: 'TrackEnded' });
  }
  mediaRecorder.start();
}

/** @param {boolean} hasAudio */
function pickMimeType(hasAudio) {
  if (hasAudio) {
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')) {
      return 'video/webm;codecs=vp9,opus';
    }
    if (MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')) {
      return 'video/webm;codecs=vp8,opus';
    }
    return 'video/webm';
  }
  if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
    return 'video/webm;codecs=vp9';
  }
  return 'video/webm';
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
