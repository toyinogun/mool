/**
 * Adapter for the Recorder page. Wires DOM events into the pure state
 * machine (`recorderFlow.js`) and executes the effects the SM emits.
 *
 * This file is the only place that touches the DOM, `MediaRecorder`,
 * `fetch`, `setInterval`, or `navigator.clipboard`. The flow logic lives
 * in `recorderFlow.js` and is unit-tested in `tests/recorderFlow.test.ts`.
 *
 * @typedef {import('./recorderFlow.js').State} State
 * @typedef {import('./recorderFlow.js').Event} FlowEvent
 * @typedef {import('./recorderFlow.js').Effect} Effect
 * @typedef {import('../routes/createUpload').CreateUploadResponse} CreateUploadResponse
 * @typedef {import('../routes/createUpload').CreateUploadErrorResponse} CreateUploadErrorResponse
 */
import { initialState, transition } from './recorderFlow.js';

const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const resultEl = document.getElementById('result');
const linkEl = document.getElementById('share-link');
const copyBtn = document.getElementById('copy');

/** @type {State} */
let state = initialState();

/** @type {MediaRecorder | null} */
let mediaRecorder = null;
/** @type {MediaStream | null} */
let activeStream = null;
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
    case 'startRecording':
      startRecording(eff.stream);
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

/** @param {MediaStream} stream */
function startRecording(stream) {
  activeStream = stream;
  chunks = [];
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = () => {
    const finalMime = mediaRecorder ? mediaRecorder.mimeType : mimeType;
    const blob = new Blob(chunks, { type: finalMime });
    dispatch({ type: 'RecorderStopped', blob, mimeType: finalMime });
  };
  // If the user clicks the browser's native "Stop sharing" UI, the track
  // ends and we want the SM to flow through Stopping just like StopClicked.
  // TrackEnded received outside Capturing is a no-op (see recorderFlow.js).
  stream.getVideoTracks()[0].onended = () => {
    dispatch({ type: 'TrackEnded' });
  };
  mediaRecorder.start();
}

/**
 * @param {string} mimeType
 * @param {number} sizeBytes
 */
async function mintUpload(mimeType, sizeBytes) {
  let res;
  try {
    res = await fetch('/create-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: mimeType, sizeBytes }),
    });
  } catch {
    dispatch({ type: 'CreateFailed', reason: 'could not reach server' });
    return;
  }
  let body;
  try {
    body = await res.json();
  } catch {
    dispatch({ type: 'CreateFailed', reason: 'unreadable response' });
    return;
  }
  if (!res.ok) {
    /** @type {CreateUploadErrorResponse} */
    const errBody = body;
    dispatch({
      type: 'CreateFailed',
      reason: errBody.error ?? String(res.status),
    });
    return;
  }
  /** @type {CreateUploadResponse} */
  const ok = body;
  dispatch({
    type: 'CreateOk',
    slug: ok.slug,
    uploadUrl: ok.uploadUrl,
    viewerUrl: ok.viewerUrl,
  });
}

/**
 * @param {string} uploadUrl
 * @param {Blob} blob
 * @param {string} mimeType
 */
async function putBytes(uploadUrl, blob, mimeType) {
  let res;
  try {
    res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: blob,
    });
  } catch {
    dispatch({ type: 'PutFailed', reason: 'Upload failed during transfer.' });
    return;
  }
  if (!res.ok) {
    dispatch({
      type: 'PutFailed',
      reason: `Upload to storage failed: HTTP ${res.status}`,
    });
    return;
  }
  dispatch({ type: 'PutOk' });
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

startBtn.addEventListener('click', () => dispatch({ type: 'StartClicked' }));
stopBtn.addEventListener('click', () => dispatch({ type: 'StopClicked' }));
copyBtn.addEventListener('click', () => dispatch({ type: 'CopyClicked' }));
