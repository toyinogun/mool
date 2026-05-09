/**
 * Pure state machine for the Recorder page.
 *
 * Drives the user-visible flow: Idle → Starting → Capturing → Stopping →
 * MintingUrl → Uploading → Done | Failed. The reducer is a pure function:
 * given (state, event) it returns the next state and a list of effects the
 * adapter should perform. The reducer never touches the DOM, the network,
 * or `MediaRecorder` directly — those live in `recorder.js` (the adapter).
 *
 * Tested in `tests/recorderFlow.test.ts`. The browser loads this file
 * via ES modules (`<script type="module">`), no bundler involved.
 */

/**
 * @typedef {{ kind: 'Idle' }} StateIdle
 * @typedef {{ kind: 'Starting' }} StateStarting
 * @typedef {{ kind: 'Starting', audioStream: MediaStream }} StateStartingWithAudio
 * @typedef {{ kind: 'RequestingMic' }} StateRequestingMic
 * @typedef {{ kind: 'Capturing' }} StateCapturing
 * @typedef {{ kind: 'Stopping' }} StateStopping
 * @typedef {{ kind: 'MintingUrl', blob: Blob, mimeType: string }} StateMintingUrl
 * @typedef {{ kind: 'Uploading', blob: Blob, mimeType: string, uploadUrl: string, viewerUrl: string }} StateUploading
 * @typedef {{ kind: 'Done', viewerUrl: string }} StateDone
 * @typedef {{ kind: 'Failed', message: string }} StateFailed
 *
 * @typedef {StateIdle | StateStarting | StateStartingWithAudio | StateRequestingMic
 *          | StateCapturing | StateStopping | StateMintingUrl | StateUploading
 *          | StateDone | StateFailed} State
 */

/**
 * @typedef {{ type: 'StartClicked', audioEnabled: boolean }} EventStartClicked
 * @typedef {{ type: 'StopClicked' }} EventStopClicked
 * @typedef {{ type: 'DisplayMediaGranted', stream: MediaStream }} EventDisplayMediaGranted
 * @typedef {{ type: 'DisplayMediaFailed', reason: string }} EventDisplayMediaFailed
 * @typedef {{ type: 'UserMediaGranted', stream: MediaStream }} EventUserMediaGranted
 * @typedef {{ type: 'UserMediaFailed', reason: string }} EventUserMediaFailed
 * @typedef {{ type: 'TrackEnded' }} EventTrackEnded
 * @typedef {{ type: 'RecorderStopped', blob: Blob, mimeType: string }} EventRecorderStopped
 * @typedef {{ type: 'CreateOk', slug: string, uploadUrl: string, viewerUrl: string }} EventCreateOk
 * @typedef {{ type: 'CreateFailed', reason: string }} EventCreateFailed
 * @typedef {{ type: 'PutOk' }} EventPutOk
 * @typedef {{ type: 'PutFailed', reason: string }} EventPutFailed
 * @typedef {{ type: 'CopyClicked' }} EventCopyClicked
 *
 * @typedef {EventStartClicked | EventStopClicked | EventDisplayMediaGranted
 *          | EventDisplayMediaFailed | EventTrackEnded | EventRecorderStopped
 *          | EventCreateOk | EventCreateFailed | EventPutOk | EventPutFailed
 *          | EventCopyClicked | EventUserMediaGranted | EventUserMediaFailed} Event
 */

/**
 * @typedef {{ type: 'requestDisplayMedia' }} EffectRequestDisplayMedia
 * @typedef {{ type: 'requestUserMedia' }} EffectRequestUserMedia
 * @typedef {{ type: 'startRecording', stream: MediaStream, audioStream?: MediaStream }} EffectStartRecording
 * @typedef {{ type: 'stopRecording' }} EffectStopRecording
 * @typedef {{ type: 'releaseStream' }} EffectReleaseStream
 * @typedef {{ type: 'mintUpload', mimeType: string, sizeBytes: number }} EffectMintUpload
 * @typedef {{ type: 'putBytes', uploadUrl: string, blob: Blob, mimeType: string }} EffectPutBytes
 * @typedef {{ type: 'setStatus', message: string }} EffectSetStatus
 * @typedef {{ type: 'setButtons', startEnabled: boolean, stopEnabled: boolean }} EffectSetButtons
 * @typedef {{ type: 'startTimer' }} EffectStartTimer
 * @typedef {{ type: 'stopTimer' }} EffectStopTimer
 * @typedef {{ type: 'showResult', viewerUrl: string }} EffectShowResult
 * @typedef {{ type: 'hideResult' }} EffectHideResult
 * @typedef {{ type: 'copyToClipboard', text: string }} EffectCopyToClipboard
 *
 * @typedef {EffectRequestDisplayMedia | EffectRequestUserMedia
 *          | EffectStartRecording | EffectStopRecording
 *          | EffectReleaseStream | EffectMintUpload | EffectPutBytes
 *          | EffectSetStatus | EffectSetButtons | EffectStartTimer | EffectStopTimer
 *          | EffectShowResult | EffectHideResult | EffectCopyToClipboard} Effect
 */

/** @returns {State} */
export function initialState() {
  return { kind: 'Idle' };
}

/**
 * Pure reducer. Maps (state, event) to a next state and a list of effects.
 *
 * Events received in invalid states are no-ops (same state, no effects).
 * This is intentional: it lets the adapter wire DOM events without
 * defensive guards (e.g. a stale "Stop sharing" callback after upload
 * starts is silently ignored rather than blowing up the flow).
 *
 * @param {State} state
 * @param {Event} event
 * @returns {{ next: State, effects: Effect[] }}
 */
export function transition(state, event) {
  switch (event.type) {
    case 'StartClicked': {
      // Valid from Idle, Done, or Failed — kicks off a fresh capture.
      if (state.kind !== 'Idle' && state.kind !== 'Done' && state.kind !== 'Failed') {
        return noop(state);
      }
      const common = [
        { type: 'hideResult' },
        { type: 'setStatus', message: '' },
        { type: 'setButtons', startEnabled: false, stopEnabled: false },
      ];
      if (event.audioEnabled) {
        return {
          next: { kind: 'RequestingMic' },
          effects: [...common, { type: 'requestUserMedia' }],
        };
      }
      return {
        next: { kind: 'Starting' },
        effects: [...common, { type: 'requestDisplayMedia' }],
      };
    }

    case 'UserMediaGranted': {
      if (state.kind !== 'RequestingMic') return noop(state);
      return {
        next: { kind: 'Starting', audioStream: event.stream },
        effects: [{ type: 'requestDisplayMedia' }],
      };
    }

    case 'UserMediaFailed': {
      if (state.kind !== 'RequestingMic') return noop(state);
      return {
        next: { kind: 'Failed', message: event.reason },
        effects: [
          { type: 'setStatus', message: event.reason },
          { type: 'setButtons', startEnabled: true, stopEnabled: false },
        ],
      };
    }

    case 'DisplayMediaGranted': {
      if (state.kind !== 'Starting') return noop(state);
      // state.audioStream is set iff we entered via the mic-on path
      // (StateStartingWithAudio); pass it through for the adapter to merge.
      const startRecording = state.audioStream
        ? { type: 'startRecording', stream: event.stream, audioStream: state.audioStream }
        : { type: 'startRecording', stream: event.stream };
      return {
        next: { kind: 'Capturing' },
        effects: [
          startRecording,
          { type: 'setStatus', message: 'Recording…' },
          { type: 'setButtons', startEnabled: false, stopEnabled: true },
          { type: 'startTimer' },
        ],
      };
    }

    case 'DisplayMediaFailed': {
      if (state.kind !== 'Starting') return noop(state);
      const effects = [];
      // Mic-on path held an audioStream that startRecording never consumed;
      // release it so the browser tab's mic indicator goes off.
      if (state.audioStream) {
        effects.push({ type: 'releaseStream' });
      }
      effects.push(
        { type: 'setStatus', message: `Could not start capture: ${event.reason}` },
        { type: 'setButtons', startEnabled: true, stopEnabled: false },
      );
      return {
        next: { kind: 'Failed', message: event.reason },
        effects,
      };
    }

    case 'StopClicked':
    case 'TrackEnded': {
      if (state.kind !== 'Capturing') return noop(state);
      return {
        next: { kind: 'Stopping' },
        effects: [
          { type: 'stopRecording' },
          { type: 'setButtons', startEnabled: false, stopEnabled: false },
          { type: 'stopTimer' },
        ],
      };
    }

    case 'RecorderStopped': {
      if (state.kind !== 'Stopping') return noop(state);
      if (event.blob.size === 0) {
        return {
          next: { kind: 'Failed', message: 'Recording was empty — nothing to upload.' },
          effects: [
            { type: 'releaseStream' },
            { type: 'setStatus', message: 'Recording was empty — nothing to upload.' },
            { type: 'setButtons', startEnabled: true, stopEnabled: false },
          ],
        };
      }
      return {
        next: { kind: 'MintingUrl', blob: event.blob, mimeType: event.mimeType },
        effects: [
          { type: 'releaseStream' },
          { type: 'setStatus', message: 'Uploading…' },
          { type: 'mintUpload', mimeType: event.mimeType, sizeBytes: event.blob.size },
        ],
      };
    }

    case 'CreateOk': {
      if (state.kind !== 'MintingUrl') return noop(state);
      return {
        next: {
          kind: 'Uploading',
          blob: state.blob,
          mimeType: state.mimeType,
          uploadUrl: event.uploadUrl,
          viewerUrl: event.viewerUrl,
        },
        effects: [
          {
            type: 'putBytes',
            uploadUrl: event.uploadUrl,
            blob: state.blob,
            mimeType: state.mimeType,
          },
        ],
      };
    }

    case 'CreateFailed': {
      if (state.kind !== 'MintingUrl') return noop(state);
      return {
        next: { kind: 'Failed', message: event.reason },
        effects: [
          { type: 'setStatus', message: `Upload rejected: ${event.reason}` },
          { type: 'setButtons', startEnabled: true, stopEnabled: false },
        ],
      };
    }

    case 'PutOk': {
      if (state.kind !== 'Uploading') return noop(state);
      return {
        next: { kind: 'Done', viewerUrl: state.viewerUrl },
        effects: [
          { type: 'setStatus', message: 'Done!' },
          { type: 'showResult', viewerUrl: state.viewerUrl },
          { type: 'setButtons', startEnabled: true, stopEnabled: false },
        ],
      };
    }

    case 'PutFailed': {
      if (state.kind !== 'Uploading') return noop(state);
      return {
        next: { kind: 'Failed', message: event.reason },
        effects: [
          { type: 'setStatus', message: event.reason },
          { type: 'setButtons', startEnabled: true, stopEnabled: false },
        ],
      };
    }

    case 'CopyClicked': {
      if (state.kind !== 'Done') return noop(state);
      return {
        next: state,
        effects: [{ type: 'copyToClipboard', text: state.viewerUrl }],
      };
    }

    default: {
      // Exhaustiveness — TypeScript would catch this at compile time;
      // here it's a runtime safety net.
      return noop(state);
    }
  }
}

/**
 * @param {State} state
 * @returns {{ next: State, effects: Effect[] }}
 */
function noop(state) {
  return { next: state, effects: [] };
}
