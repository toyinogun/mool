/**
 * Canvas-based picture-in-picture compositor for the Recorder page.
 *
 * Takes a screen MediaStream and a camera MediaStream and returns a single
 * composite MediaStream whose video track is a hidden <canvas> drawn on a
 * tick from a Web Worker: the screen frame as the base layer, then the
 * webcam clipped to a circle in the bottom-left at 18% of canvas height
 * with a 4% margin from both edges. The webcam frame is centre-cropped to
 * a square before draw so 16:9 or 4:3 webcam feeds aren't distorted by the
 * circular clip.
 *
 * Drawing is driven by a setInterval inside a Web Worker rather than
 * requestAnimationFrame because background tabs throttle rAF to ~1 Hz,
 * which froze the recorded video when the user switched to the tab they
 * were recording. Worker timers aren't subject to visibility throttling,
 * and postMessage tasks on the main thread aren't treated as timer tasks,
 * so draws continue at ~30 fps while the Recorder tab is hidden.
 *
 * The composite is video-only. Audio merging stays in recorderCapture.js
 * (single source of truth for mime-type selection); the adapter passes
 * audioStream straight to capture.start() as in v0.2.
 *
 * The screen track ending (e.g. user clicks the browser's "Stop sharing"
 * toolbar) is propagated as the composite video track ending, so
 * recorderCapture.js's onTrackEnded wiring catches it as TrackEnded →
 * Stopping. The camera track ending (e.g. USB cam unplugged) is propagated
 * via the onCameraEnded callback only — the composite continues drawing
 * screen-only, MediaRecorder is unaffected, and the recording gracefully
 * becomes screen-only from that point.
 *
 * @typedef {{
 *   compositeStream: MediaStream,
 *   stop: () => void,
 *   onCameraEnded: (cb: () => void) => void,
 * }} Composite
 */

/**
 * @param {{ screenStream: MediaStream, cameraStream: MediaStream }} args
 * @returns {Composite}
 */
export function composeStreams({ screenStream, cameraStream }) {
  const screenTrack = screenStream.getVideoTracks()[0];
  const cameraTrack = cameraStream.getVideoTracks()[0];
  if (!screenTrack) throw new Error('composeStreams: screenStream has no video track');
  if (!cameraTrack) throw new Error('composeStreams: cameraStream has no video track');

  const settings = screenTrack.getSettings();
  const canvasWidth = settings.width || 1920;
  const canvasHeight = settings.height || 1080;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('composeStreams: 2d canvas context unavailable');

  // Off-screen video elements feed the canvas. Both are muted (audio never
  // flows through here) and play immediately so currentTime/frames are live.
  const screenVideo = document.createElement('video');
  screenVideo.muted = true;
  screenVideo.autoplay = true;
  screenVideo.playsInline = true;
  screenVideo.srcObject = screenStream;
  void screenVideo.play().catch(() => {
    /* play() rejects if the element is removed before it resolves; harmless. */
  });

  const cameraVideo = document.createElement('video');
  cameraVideo.muted = true;
  cameraVideo.autoplay = true;
  cameraVideo.playsInline = true;
  cameraVideo.srcObject = cameraStream;
  void cameraVideo.play().catch(() => {});

  // PIP geometry per spec §7.
  const pipDiameter = canvasHeight * 0.18;
  const pipRadius = pipDiameter / 2;
  const pipMarginX = canvasWidth * 0.04;
  const pipMarginY = canvasHeight * 0.04;
  const pipCx = pipMarginX + pipRadius;
  const pipCy = canvasHeight - pipMarginY - pipRadius;

  let cameraActive = true;
  /** @type {Array<() => void>} */
  const cameraEndedCallbacks = [];

  cameraTrack.addEventListener('ended', () => {
    if (stopped) return;
    cameraActive = false;
    for (const cb of cameraEndedCallbacks) {
      try { cb(); } catch { /* swallow — one bad listener shouldn't stop others */ }
    }
  });

  let stopped = false;

  function draw() {
    if (stopped) return;

    // Base: screen frame.
    if (screenVideo.readyState >= 2) {
      try {
        ctx.drawImage(screenVideo, 0, 0, canvasWidth, canvasHeight);
      } catch {
        /* drawImage can throw if the element is detached mid-frame; ignore. */
      }
    }

    // Overlay: webcam, centre-cropped to a square then drawn into a circular clip.
    if (cameraActive && cameraVideo.readyState >= 2) {
      const camW = cameraVideo.videoWidth;
      const camH = cameraVideo.videoHeight;
      if (camW > 0 && camH > 0) {
        // Centre-crop source to square.
        const side = Math.min(camW, camH);
        const sx = (camW - side) / 2;
        const sy = (camH - side) / 2;

        ctx.save();
        ctx.beginPath();
        ctx.arc(pipCx, pipCy, pipRadius, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip();
        try {
          ctx.drawImage(
            cameraVideo,
            sx, sy, side, side,
            pipCx - pipRadius, pipCy - pipRadius, pipDiameter, pipDiameter,
          );
        } catch {
          /* same defensive ignore as above */
        }
        ctx.restore();
      }
    }
  }

  // Inline Web Worker that fires a tick every ~33 ms (≈30 fps). Worker
  // setInterval keeps running at full rate while the tab is hidden, so the
  // canvas keeps getting redrawn for the duration of the recording.
  const tickWorkerSource = `
    let tickId = null;
    self.onmessage = (e) => {
      if (e.data === 'start') {
        tickId = setInterval(() => self.postMessage(0), 33);
      } else if (e.data === 'stop') {
        clearInterval(tickId);
        tickId = null;
      }
    };
  `;
  const tickWorkerUrl = URL.createObjectURL(
    new Blob([tickWorkerSource], { type: 'application/javascript' }),
  );
  const tickWorker = new Worker(tickWorkerUrl);
  tickWorker.onmessage = () => {
    if (!stopped) draw();
  };
  tickWorker.postMessage('start');

  // The composite's video track. captureStream samples the canvas at 30 fps
  // regardless of how often draw() runs.
  /** @type {any} */
  const captureStreamFn =
    /** @type {any} */ (canvas).captureStream
    || /** @type {any} */ (canvas).mozCaptureStream;
  if (!captureStreamFn) {
    throw new Error('composeStreams: canvas.captureStream is not supported in this browser');
  }
  const compositeStream = /** @type {MediaStream} */ (captureStreamFn.call(canvas, 30));

  // When the screen track ends (user clicks the browser's Stop-Sharing toolbar),
  // stop the composite video track so capture's onTrackEnded wiring fires.
  screenTrack.addEventListener('ended', () => {
    for (const t of compositeStream.getVideoTracks()) {
      try { t.stop(); } catch { /* idempotent */ }
    }
  });

  function stop() {
    if (stopped) return;
    stopped = true;
    try { tickWorker.postMessage('stop'); } catch { /* worker may already be gone */ }
    tickWorker.terminate();
    URL.revokeObjectURL(tickWorkerUrl);
    for (const t of compositeStream.getVideoTracks()) {
      try { t.stop(); } catch { /* idempotent */ }
    }
    // Release the off-screen video elements' refs so the GC can reclaim them
    // and the underlying source-stream readers wind down.
    screenVideo.srcObject = null;
    cameraVideo.srcObject = null;
  }

  return {
    compositeStream,
    stop,
    onCameraEnded(cb) {
      cameraEndedCallbacks.push(cb);
    },
  };
}
