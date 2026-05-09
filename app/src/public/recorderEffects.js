/**
 * Effect dispatcher for the Recorder page.
 *
 * Maps each `Effect` emitted by the state machine (`recorderFlow.js`) to a
 * call against `ports`. Synchronous effects are direct port calls;
 * asynchronous effects await an outcome and translate it to the matching
 * SM event via `ports.dispatch`. The async-outcome → SM-event translation
 * is the load-bearing reason this module exists separately from
 * `recorder.js` — see ADR-0013 — because in JS+JSDoc no type system catches
 * a renamed event silently dropping on the floor.
 *
 * `recorder.js` builds the real `ports` (DOM mutations, timer, clipboard,
 * `Capture`, `recorderUpload` calls) and wires this module into its
 * dispatch loop. Tests in `tests/recorderEffects.test.ts` substitute fake
 * ports and assert each effect's port-call shape and (for async effects)
 * the dispatched SM event.
 *
 * @typedef {import('./recorderFlow.js').Effect} Effect
 * @typedef {import('./recorderFlow.js').Event} FlowEvent
 *
 * @typedef {{ kind: 'ok', stream: MediaStream } | { kind: 'failed', reason: string }} StreamOutcome
 * @typedef {{ kind: 'ok', slug: string, uploadUrl: string, viewerUrl: string } | { kind: 'failed', reason: string }} MintOutcome
 * @typedef {{ kind: 'ok' } | { kind: 'failed', reason: string }} PutOutcome
 *
 * @typedef {object} Ports
 * @property {(message: string) => void} setStatus
 * @property {(args: { startEnabled: boolean, stopEnabled: boolean }) => void} setButtons
 * @property {() => void} startTimer
 * @property {() => void} stopTimer
 * @property {(viewerUrl: string) => void} showResult
 * @property {() => void} hideResult
 * @property {(text: string) => void} copyToClipboard
 * @property {() => void} releaseStream
 * @property {() => Promise<StreamOutcome>} requestDisplay
 * @property {() => Promise<StreamOutcome>} requestUser
 * @property {(stream: MediaStream, audioStream: MediaStream | undefined, onTrackEnded: () => void) => void} startCapture
 * @property {() => Promise<{ blob: Blob, mimeType: string }>} stopCapture
 * @property {(args: { mimeType: string, sizeBytes: number }) => Promise<MintOutcome>} mintUpload
 * @property {(args: { uploadUrl: string, blob: Blob, mimeType: string }) => Promise<PutOutcome>} putBytes
 * @property {(event: FlowEvent) => void} dispatch
 */

/**
 * @param {Effect} eff
 * @param {Ports} ports
 * @returns {Promise<void>}
 */
export async function runEffect(eff, ports) {
  switch (eff.type) {
    case 'setStatus':
      ports.setStatus(eff.message);
      return;

    case 'setButtons':
      ports.setButtons({
        startEnabled: eff.startEnabled,
        stopEnabled: eff.stopEnabled,
      });
      return;

    case 'startTimer':
      ports.startTimer();
      return;

    case 'stopTimer':
      ports.stopTimer();
      return;

    case 'showResult':
      ports.showResult(eff.viewerUrl);
      return;

    case 'hideResult':
      ports.hideResult();
      return;

    case 'copyToClipboard':
      ports.copyToClipboard(eff.text);
      return;

    case 'releaseStream':
      ports.releaseStream();
      return;

    case 'startRecording':
      ports.startCapture(eff.stream, eff.audioStream, () =>
        ports.dispatch({ type: 'TrackEnded' }),
      );
      return;

    case 'requestDisplayMedia': {
      const r = await ports.requestDisplay();
      if (r.kind === 'ok') {
        ports.dispatch({ type: 'DisplayMediaGranted', stream: r.stream });
      } else {
        ports.dispatch({ type: 'DisplayMediaFailed', reason: r.reason });
      }
      return;
    }

    case 'requestUserMedia': {
      const r = await ports.requestUser();
      if (r.kind === 'ok') {
        ports.dispatch({ type: 'UserMediaGranted', stream: r.stream });
      } else {
        ports.dispatch({ type: 'UserMediaFailed', reason: r.reason });
      }
      return;
    }

    case 'stopRecording': {
      const { blob, mimeType } = await ports.stopCapture();
      ports.dispatch({ type: 'RecorderStopped', blob, mimeType });
      return;
    }

    case 'mintUpload': {
      const r = await ports.mintUpload({
        mimeType: eff.mimeType,
        sizeBytes: eff.sizeBytes,
      });
      if (r.kind === 'ok') {
        ports.dispatch({
          type: 'CreateOk',
          slug: r.slug,
          uploadUrl: r.uploadUrl,
          viewerUrl: r.viewerUrl,
        });
      } else {
        ports.dispatch({ type: 'CreateFailed', reason: r.reason });
      }
      return;
    }

    case 'putBytes': {
      const r = await ports.putBytes({
        uploadUrl: eff.uploadUrl,
        blob: eff.blob,
        mimeType: eff.mimeType,
      });
      if (r.kind === 'ok') {
        ports.dispatch({ type: 'PutOk' });
      } else {
        ports.dispatch({ type: 'PutFailed', reason: r.reason });
      }
      return;
    }

    default: {
      // A new Effect variant added to recorderFlow.js without a case here
      // would otherwise no-op silently — the SM emits the effect and
      // nothing happens. The throw makes the gap loud at the test that
      // exercises the new variant.
      const _exhaustive = /** @type {never} */ (eff);
      throw new Error(`Unknown effect type: ${JSON.stringify(_exhaustive)}`);
    }
  }
}
