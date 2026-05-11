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
 * receive only an opaque `{ close }` handle. The bubble's `<video>` and
 * Stop button are styled by an inlined `<style>` block in `populate()`
 * (mirroring the values from styles.css) — `copyStyleSheets` proved
 * unreliable for linked external stylesheets in current Chrome.
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
 * MM:SS format, two-digit padded, no hour rollover. Duplicated from
 * recorder.js (see spec §4): pulling it across the module boundary would
 * require either exporting a recorder-page helper or moving it to a shared
 * module — larger refactors than four lines of trivial logic justify.
 *
 * @param {number} ms
 */
function formatElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

/**
 * Open the floating-camera overlay. Returns an opaque handle synchronously;
 * the bubble appears asynchronously. Throws synchronously only if the API
 * is missing — guard with `isFloatingCamSupported()` to avoid this path.
 *
 * `startedAt` is the `Date.now()` reading at which the recording began. The
 * PiP window runs its own 1Hz interval and renders `Date.now() - startedAt`
 * into a timer element. There is one clock (owned by `recorder.js`) and two
 * displays.
 *
 * @param {{
 *   cameraStream: MediaStream,
 *   onStopClicked: () => void,
 *   startedAt: number,
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
  startedAt,
  onClosed,
  onError,
  width = 240,
  height = 320,
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
  /** @type {ReturnType<typeof setInterval> | null} */
  let timerInterval = null;

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
      });
    } catch (err) {
      if (!closeRequested) {
        // Always log so devtools shows a breadcrumb, even when onError is
        // wired (callers commonly map err → fixed status string and would
        // otherwise eat the underlying cause).
        console.error('openFloatingCam: requestWindow failed', err);
        if (onError) {
          try { onError(err); } catch { /* one bad listener shouldn't stop teardown */ }
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

    // Self-contained styles. copyStyleSheets is unreliable for linked external
    // stylesheets in current Chrome (the spec rated this Low; field testing
    // promoted it to Likely), so inline what the bubble needs rather than
    // depend on /styles.css carrying over. Colour values mirror the CSS
    // variables in styles.css; the PIP document has no :root definitions of
    // its own. Dark background so the brief gap before <video>'s first
    // painted frame reads as "loading" rather than "broken".
    const style = doc.createElement('style');
    style.textContent = `
      body {
        margin: 0;
        padding: 12px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        background: #0e1116;
        color: #e6edf3;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      .cam-preview {
        width: 200px;
        height: 200px;
        border-radius: 50%;
        object-fit: cover;
        background: #000;
        border: 2px solid #30363d;
        transform: scaleX(-1);
      }
      .cam-timer {
        font-family: ui-monospace, "JetBrains Mono", "SF Mono", Menlo, monospace;
        font-size: 18px;
        font-weight: 600;
        font-variant-numeric: tabular-nums;
        letter-spacing: 0.04em;
        color: #e6edf3;
      }
      button.primary {
        padding: 0.5rem 1.25rem;
        font-size: 0.95rem;
        border-radius: 6px;
        border: 1px solid #da3633;
        background: #da3633;
        color: #ffffff;
        cursor: pointer;
        font-family: inherit;
      }
      button.primary:hover { background: #cf2c2c; }
    `;
    doc.head.appendChild(style);

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

    // Live recording timer. 1Hz interval inside the PiP window itself, so the
    // PiP owns its own ticking and the recorder.js module doesn't reach in.
    const timerEl = doc.createElement('div');
    timerEl.className = 'cam-timer';
    timerEl.textContent = formatElapsed(Date.now() - startedAt);
    doc.body.appendChild(timerEl);

    timerInterval = win.setInterval(() => {
      timerEl.textContent = formatElapsed(Date.now() - startedAt);
    }, 1000);

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
      if (timerInterval !== null) {
        try { win.clearInterval(timerInterval); } catch { /* doc may be torn down */ }
        timerInterval = null;
      }
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
    if (timerInterval !== null && pipWindow) {
      try { pipWindow.clearInterval(timerInterval); } catch { /* doc may be torn down */ }
      timerInterval = null;
    }
    if (pipWindow) {
      try { if (video) video.srcObject = null; } catch { /* doc may be torn down */ }
      try { pipWindow.close(); } catch { /* idempotent */ }
    }
    // If pipWindow is still null, the IIFE will see closeRequested and dispose
    // the window the moment it arrives.
  }

  return { close };
}
