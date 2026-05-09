/**
 * Capture lifecycle for the Recorder page.
 *
 * Owns the in-browser, pre-upload state of a recording-in-progress: the
 * `MediaStream`(s), the `MediaRecorder`, and the accumulated chunks. The
 * Recorder page adapter (`recorder.js`) holds a single `Capture` instance
 * instead of six closure variables, and the chunks→Blob payload that drives
 * `RecorderStopped` becomes a Promise resolution with a pinned mimeType
 * rather than a `MediaRecorder.onstop` callback firing into a closure.
 *
 * `pickMimeType` is exported separately because it's a pure rule referenced
 * cross-tier (`ALLOWED_MIME` server-side, capture client-side); leaving it
 * embedded in `start()` would block direct testability.
 *
 * Tested in `tests/recorderCapture.test.ts` against fake `navigator` and
 * `MediaRecorderCtor` deps.
 */

/**
 * @typedef {{ kind: 'ok', stream: MediaStream }} StreamOk
 * @typedef {{ kind: 'failed', reason: string }} StreamFailed
 * @typedef {StreamOk | StreamFailed} StreamOutcome
 */

/**
 * @param {boolean} hasAudio
 * @returns {string}
 */
export function pickMimeType(hasAudio) {
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
 * @param {{
 *   navigator: { mediaDevices?: { getDisplayMedia?: Function, getUserMedia?: Function } },
 *   MediaRecorderCtor: typeof MediaRecorder,
 *   pickMimeType?: (hasAudio: boolean) => string,
 * }} deps
 */
export function createCapture({ navigator, MediaRecorderCtor, pickMimeType: pickMimeTypeOverride }) {
  /** @type {MediaStream | null} */
  let screenStream = null;
  /** @type {MediaStream | null} */
  let audioStream = null;
  /** @type {MediaRecorder | null} */
  let mediaRecorder = null;
  /** @type {Blob[]} */
  let chunks = [];
  /** @type {string | null} */
  let pinnedMimeType = null;

  const pick = pickMimeTypeOverride ?? pickMimeType;

  return {
    /** @returns {Promise<StreamOutcome>} */
    async requestDisplay() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        return {
          kind: 'failed',
          reason:
            'getDisplayMedia is unavailable. The page must be served over https or http://localhost — check your URL.',
        };
      }
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
        });
        return { kind: 'ok', stream };
      } catch (err) {
        const name = err && err.name ? err.name : 'Error';
        const message = err && err.message ? err.message : String(err);
        return { kind: 'failed', reason: `${name} — ${message}` };
      }
    },

    /** @returns {Promise<StreamOutcome>} */
    async requestUser() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return {
          kind: 'failed',
          reason:
            'Microphone API unavailable. The page must be served over https or http://localhost — check your URL.',
        };
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // Hold the stream so release() can clean it up even if the screen-share
        // prompt is denied (no start() yet). start() will overwrite this with
        // the SM-supplied audioStream — same instance in practice, since the
        // SM passes the same stream back through.
        audioStream = stream;
        return { kind: 'ok', stream };
      } catch (err) {
        const name = err && err.name ? err.name : 'Error';
        let reason;
        if (name === 'NotFoundError') {
          reason = 'No microphone found. Turn off the mic toggle to record silently.';
        } else if (name === 'NotAllowedError' || name === 'SecurityError') {
          reason =
            'Microphone access denied. Allow it in your browser, or turn off the mic toggle to record silently.';
        } else {
          const detail = err && err.message ? err.message : String(err);
          reason = `Microphone error: ${name} — ${detail}`;
        }
        return { kind: 'failed', reason };
      }
    },

    /**
     * Begin recording. If `optAudioStream` is provided, its audio tracks are
     * merged into `stream` so a single MediaRecorder produces one container
     * with both video and audio. If `onTrackEnded` is provided, it is wired
     * to every track on the (merged) stream — either source ending (the
     * screen-share toolbar's Stop, the mic being unplugged) flows through
     * one callback. The wiring runs AFTER the merge so newly-added audio
     * tracks are included.
     *
     * @param {MediaStream} stream
     * @param {MediaStream | undefined} [optAudioStream]
     * @param {(() => void) | undefined} [onTrackEnded]
     */
    start(stream, optAudioStream, onTrackEnded) {
      screenStream = stream;
      if (optAudioStream) audioStream = optAudioStream;

      if (audioStream) {
        for (const track of audioStream.getAudioTracks()) {
          stream.addTrack(track);
        }
      }

      if (onTrackEnded) {
        for (const track of stream.getTracks()) {
          track.onended = onTrackEnded;
        }
      }

      chunks = [];
      const mimeType = pick(Boolean(audioStream));
      pinnedMimeType = mimeType;
      mediaRecorder = new MediaRecorderCtor(stream, { mimeType });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      mediaRecorder.start();
    },

    /**
     * Stop the recorder and resolve once the final chunks have arrived. The
     * resolved mimeType is the one we passed to the MediaRecorder constructor —
     * `mediaRecorder.mimeType` may normalise codec ordering or add quoting,
     * and the server's `ALLOWED_MIME` allow-list does exact-string comparison.
     *
     * @returns {Promise<{ blob: Blob, mimeType: string }>}
     */
    stop() {
      return new Promise((resolve) => {
        if (!mediaRecorder || !pinnedMimeType) {
          // Defensive: stop() called without start(). Resolve with an empty
          // blob; the SM treats size===0 as Failed → "Recording was empty."
          resolve({
            blob: new Blob([], { type: 'video/webm' }),
            mimeType: 'video/webm',
          });
          return;
        }
        const mimeType = pinnedMimeType;
        mediaRecorder.onstop = () => {
          resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
        };
        if (mediaRecorder.state !== 'inactive') {
          mediaRecorder.stop();
        } else {
          // Already stopped (rare race). Resolve with whatever we have.
          resolve({ blob: new Blob(chunks, { type: mimeType }), mimeType });
        }
      });
    },

    /**
     * Stop both held streams and drop references. Idempotent — calling twice
     * is safe. Stopping an already-ended `MediaStreamTrack` is a spec-defined
     * no-op (relevant because start() merges audio tracks into the screen
     * stream, so a single track may be reachable via both).
     */
    release() {
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        screenStream = null;
      }
      if (audioStream) {
        audioStream.getTracks().forEach((t) => t.stop());
        audioStream = null;
      }
      mediaRecorder = null;
      chunks = [];
      pinnedMimeType = null;
    },
  };
}
