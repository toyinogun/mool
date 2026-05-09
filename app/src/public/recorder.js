const startBtn = document.getElementById('start');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const timerEl = document.getElementById('timer');
const resultEl = document.getElementById('result');
const linkEl = document.getElementById('share-link');
const copyBtn = document.getElementById('copy');

let mediaRecorder = null;
let chunks = [];
let stream = null;
let timerInterval = null;
let startTime = 0;

function setStatus(msg) {
  statusEl.textContent = msg;
}

function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function resetUiAfterFailure() {
  startBtn.disabled = false;
  stopBtn.disabled = true;
  clearInterval(timerInterval);
  timerEl.textContent = '';
}

async function start() {
  resultEl.hidden = true;
  setStatus('');
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 30 },
      audio: false,
    });
  } catch (err) {
    setStatus('Screen-share permission denied or cancelled.');
    return;
  }

  chunks = [];
  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  mediaRecorder = new MediaRecorder(stream, { mimeType });
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  mediaRecorder.onstop = onRecordingStopped;

  // If the user clicks the browser's native "Stop sharing" UI,
  // end the recorder gracefully.
  stream.getVideoTracks()[0].onended = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  };

  mediaRecorder.start();
  startTime = Date.now();
  startBtn.disabled = true;
  stopBtn.disabled = false;
  setStatus('Recording…');
  timerInterval = setInterval(() => {
    timerEl.textContent = formatElapsed(Date.now() - startTime);
  }, 200);
}

function stop() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

async function onRecordingStopped() {
  clearInterval(timerInterval);
  stopBtn.disabled = true;
  setStatus('Uploading…');

  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
  }

  const blob = new Blob(chunks, { type: 'video/webm' });

  let createRes;
  try {
    createRes = await fetch('/create-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contentType: 'video/webm', sizeBytes: blob.size }),
    });
  } catch (err) {
    setStatus('Upload failed: could not reach server.');
    resetUiAfterFailure();
    return;
  }

  if (!createRes.ok) {
    const errBody = await createRes.json().catch(() => ({}));
    setStatus(`Upload rejected: ${errBody.error ?? createRes.status}`);
    resetUiAfterFailure();
    return;
  }

  const { uploadUrl, viewerUrl } = await createRes.json();

  let putRes;
  try {
    putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/webm' },
      body: blob,
    });
  } catch (err) {
    setStatus('Upload failed during transfer.');
    resetUiAfterFailure();
    return;
  }
  if (!putRes.ok) {
    setStatus(`Upload to storage failed: HTTP ${putRes.status}`);
    resetUiAfterFailure();
    return;
  }

  setStatus('Done!');
  linkEl.href = viewerUrl;
  linkEl.textContent = viewerUrl;
  resultEl.hidden = false;
  startBtn.disabled = false;
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(linkEl.textContent);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy link'), 1500);
  } catch {
    /* ignore — clipboard unavailable */
  }
}

startBtn.addEventListener('click', start);
stopBtn.addEventListener('click', stop);
copyBtn.addEventListener('click', copyLink);
