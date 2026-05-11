/**
 * Document Picture-in-Picture overlay for the live camera during recording.
 *
 * Opens an always-on-top floating window populated with a mirrored <video>
 * fed by the same camera MediaStream that the in-page preview uses, plus a
 * Stop button that dispatches StopClicked back into the recorder via the
 * supplied callback. Lets the user keep visual feedback while their tab is
 * backgrounded, and stop the recording without switching back to the Mool
 * tab.
 *
 * Only Chromium-based browsers expose `window.documentPictureInPicture`.
 * On Firefox/Safari, callers guard with `isFloatingCamSupported()` and skip
 * opening the bubble; the in-page note in index.html surfaces the
 * limitation to the user.
 *
 * Boundary: this module is the only place allowed to touch
 * `window.documentPictureInPicture` or build the bubble's DOM. Callers
 * receive only an opaque `{ close }` handle. The bubble's <video> reuses
 * the existing `.cam-preview` rule from styles.css, carried over by
 * `requestWindow({ copyStyleSheets: true })`.
 *
 * Async-but-sync-handle pattern: `openFloatingCam` returns immediately so
 * the synchronous `startCapture` port in recorder.js doesn't have to grow
 * an await. Internally a self-invoking async IIFE awaits
 * `requestWindow()`, populates the window, and surfaces late failures via
 * the optional `onError` callback. If `close()` runs before the window
 * arrives, the resolved window is disposed on arrival.
 *
 * @typedef {{ close: () => void }} FloatingCamHandle
 */

/**
 * Probe for Document Picture-in-Picture support. Safe to call at any time.
 *
 * @returns {boolean}
 */
export function isFloatingCamSupported() {
  return typeof window !== 'undefined' && 'documentPictureInPicture' in window;
}

/**
 * Open the floating-camera overlay. Returns an opaque handle synchronously;
 * the bubble appears asynchronously. Throws synchronously only if the API
 * is missing — guard with `isFloatingCamSupported()` to avoid this path.
 *
 * @param {{
 *   cameraStream: MediaStream,
 *   onStopClicked: () => void,
 *   onClosed?: () => void,
 *   onError?: (err: unknown) => void,
 *   width?: number,
 *   height?: number,
 * }} args
 * @returns {FloatingCamHandle}
 */
export function openFloatingCam({
  cameraStream,
  onStopClicked,
  onClosed,
  onError,
  width = 240,
  height = 280,
}) {
  /** @type {any} */
  const dpip = /** @type {any} */ (window).documentPictureInPicture;
  if (!dpip || typeof dpip.requestWindow !== 'function') {
    throw new Error('openFloatingCam: documentPictureInPicture is unavailable');
  }

  let closeRequested = false;
  /** @type {Window | null} */
  let pipWindow = null;
  /** @type {HTMLVideoElement | null} */
  let video = null;

  // Async open. The handle returned below is live the moment this returns,
  // but `close()` and `pipWindow` are coordinated by the closeRequested flag
  // so closing-before-open works.
  void (async () => {
    /** @type {Window} */
    let win;
    try {
      win = await dpip.requestWindow({
        width,
        height,
        copyStyleSheets: true,
      });
    } catch (err) {
      if (!closeRequested) {
        if (onError) {
          try { onError(err); } catch { /* one bad listener shouldn't stop teardown */ }
        } else {
          console.error('openFloatingCam: requestWindow failed', err);
        }
      }
      return;
    }
    if (closeRequested) {
      try { win.close(); } catch { /* idempotent */ }
      return;
    }
    pipWindow = win;
    populate(win);
  })();

  /** @param {Window} win */
  function populate(win) {
    const doc = win.document;

    // Tight layout. Dark background so the brief gap before <video>'s first
    // painted frame reads as "loading" rather than "broken".
    doc.body.style.margin = '0';
    doc.body.style.display = 'flex';
    doc.body.style.flexDirection = 'column';
    doc.body.style.alignItems = 'center';
    doc.body.style.justifyContent = 'center';
    doc.body.style.gap = '12px';
    doc.body.style.padding = '12px';
    doc.body.style.background = '#111';

    // <video>: reuses the .cam-preview rule (circle + mirror) carried over
    // by copyStyleSheets.
    video = doc.createElement('video');
    video.className = 'cam-preview';
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    video.srcObject = cameraStream;
    void video.play().catch(() => {
      /* play() rejects if the element is removed before it resolves; harmless. */
    });
    doc.body.appendChild(video);

    // Stop button.
    const stopBtn = doc.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'primary';
    stopBtn.textContent = 'Stop';
    doc.body.appendChild(stopBtn);

    let stopFired = false;
    stopBtn.addEventListener('click', () => {
      if (stopFired) return;
      stopFired = true;
      try { onStopClicked(); } catch (err) { console.error('openFloatingCam: onStopClicked threw', err); }
    });

    // Manual-close detection. closeRequested is set by `close()` below, so
    // pagehide caused by our own close() does NOT fire onClosed.
    let closedFired = false;
    win.addEventListener('pagehide', () => {
      if (closeRequested) return;
      if (closedFired) return;
      closedFired = true;
      if (onClosed) {
        try { onClosed(); } catch (err) { console.error('openFloatingCam: onClosed threw', err); }
      }
    });
  }

  function close() {
    if (closeRequested) return;
    closeRequested = true;
    if (pipWindow) {
      try { if (video) video.srcObject = null; } catch { /* doc may be torn down */ }
      try { pipWindow.close(); } catch { /* idempotent */ }
    }
    // If pipWindow is still null, the IIFE will see closeRequested and dispose
    // the window the moment it arrives.
  }

  return { close };
}
