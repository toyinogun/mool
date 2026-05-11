import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — JSDoc-typed JS module shipped to the browser as well.
import { initialState, transition } from '../src/public/recorderFlow.js';

// MediaStream isn't available in Node; the SM only passes it through, so a
// stub object is fine.
const fakeStream = { id: 'fake' } as unknown as MediaStream;

function bytes(size: number, mime = 'video/webm'): Blob {
  // Blob is available in Node 18+ (vitest's environment). The SM only
  // reads `.size`; the contents don't matter.
  return new Blob([new Uint8Array(size)], { type: mime });
}

describe('recorderFlow.initialState', () => {
  it('starts in Idle', () => {
    expect(initialState()).toEqual({ kind: 'Idle' });
  });
});

describe('transition: Idle', () => {
  it('StartClicked{audioEnabled:false} → Starting + clears UI + requests display media', () => {
    const r = transition(initialState(), { type: 'StartClicked', audioEnabled: false, videoEnabled: false });
    expect(r.next).toEqual({ kind: 'Starting', videoEnabled: false });
    expect(r.effects).toEqual([
      { type: 'hideResult' },
      { type: 'setStatus', message: '' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'requestDisplayMedia' },
    ]);
  });

  it('ignores StopClicked', () => {
    const r = transition(initialState(), { type: 'StopClicked' });
    expect(r.next).toEqual({ kind: 'Idle' });
    expect(r.effects).toEqual([]);
  });

  it('ignores TrackEnded', () => {
    const r = transition(initialState(), { type: 'TrackEnded' });
    expect(r.next).toEqual({ kind: 'Idle' });
    expect(r.effects).toEqual([]);
  });

  it('ignores DisplayMediaGranted (cannot happen without StartClicked first)', () => {
    const r = transition(initialState(), {
      type: 'DisplayMediaGranted',
      stream: fakeStream,
    });
    expect(r.next).toEqual({ kind: 'Idle' });
    expect(r.effects).toEqual([]);
  });
});

describe('transition: Starting', () => {
  const start = { kind: 'Starting' as const, videoEnabled: false };

  it('DisplayMediaGranted → Capturing + start recording + UI updates', () => {
    const r = transition(start, { type: 'DisplayMediaGranted', stream: fakeStream });
    expect(r.next).toEqual({ kind: 'Capturing' });
    expect(r.effects).toEqual([
      { type: 'startTimer' },
      { type: 'startRecording', stream: fakeStream, videoEnabled: false },
      { type: 'setStatus', message: 'Recording…' },
      { type: 'setButtons', startEnabled: false, stopEnabled: true },
    ]);
  });

  it('DisplayMediaFailed → Failed + status + re-enables Start', () => {
    const r = transition(start, {
      type: 'DisplayMediaFailed',
      reason: 'NotAllowedError — user dismissed',
    });
    expect(r.next).toEqual({
      kind: 'Failed',
      message: 'NotAllowedError — user dismissed',
    });
    expect(r.effects).toEqual([
      {
        type: 'setStatus',
        message:
          'Could not start capture: NotAllowedError — user dismissed',
      },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });

  it('ignores StopClicked', () => {
    const r = transition(start, { type: 'StopClicked' });
    expect(r.next).toEqual(start);
    expect(r.effects).toEqual([]);
  });
});

describe('transition: Capturing', () => {
  const capturing = { kind: 'Capturing' as const };

  it('StopClicked → Stopping + stops recorder + disables both + stops timer', () => {
    const r = transition(capturing, { type: 'StopClicked' });
    expect(r.next).toEqual({ kind: 'Stopping' });
    expect(r.effects).toEqual([
      { type: 'stopRecording' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'stopTimer' },
    ]);
  });

  it('TrackEnded behaves identically to StopClicked', () => {
    const r = transition(capturing, { type: 'TrackEnded' });
    expect(r.next).toEqual({ kind: 'Stopping' });
    expect(r.effects).toEqual([
      { type: 'stopRecording' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'stopTimer' },
    ]);
  });

  it('ignores StartClicked (already capturing)', () => {
    const r = transition(capturing, { type: 'StartClicked', audioEnabled: false, videoEnabled: false });
    expect(r.next).toEqual(capturing);
    expect(r.effects).toEqual([]);
  });
});

describe('transition: Stopping', () => {
  const stopping = { kind: 'Stopping' as const };

  it('RecorderStopped with empty blob → Failed (empty recording)', () => {
    const r = transition(stopping, {
      type: 'RecorderStopped',
      blob: bytes(0),
      mimeType: 'video/webm',
    });
    expect(r.next).toEqual({
      kind: 'Failed',
      message: 'Recording was empty — nothing to upload.',
    });
    expect(r.effects).toEqual([
      { type: 'releaseStream' },
      {
        type: 'setStatus',
        message: 'Recording was empty — nothing to upload.',
      },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });

  it('RecorderStopped with non-empty blob → MintingUrl + releases stream + mints upload', () => {
    const blob = bytes(1024, 'video/webm;codecs=vp9');
    const r = transition(stopping, {
      type: 'RecorderStopped',
      blob,
      mimeType: 'video/webm;codecs=vp9',
    });
    expect(r.next).toEqual({
      kind: 'MintingUrl',
      blob,
      mimeType: 'video/webm;codecs=vp9',
    });
    expect(r.effects).toEqual([
      { type: 'releaseStream' },
      { type: 'setStatus', message: 'Uploading…' },
      {
        type: 'mintUpload',
        mimeType: 'video/webm;codecs=vp9',
        sizeBytes: 1024,
      },
    ]);
  });

  it('ignores TrackEnded (track-end after stop is a benign double-fire)', () => {
    const r = transition(stopping, { type: 'TrackEnded' });
    expect(r.next).toEqual(stopping);
    expect(r.effects).toEqual([]);
  });
});

describe('transition: MintingUrl', () => {
  const blob = bytes(1024);
  const minting = {
    kind: 'MintingUrl' as const,
    blob,
    mimeType: 'video/webm',
  };

  it('CreateOk → Uploading + dispatches PUT with the held blob', () => {
    const r = transition(minting, {
      type: 'CreateOk',
      slug: 'abc123',
      uploadUrl: 'https://r2.test/abc123.webm?signed=1',
      viewerUrl: 'https://record.test/v/abc123',
    });
    expect(r.next).toEqual({
      kind: 'Uploading',
      blob,
      mimeType: 'video/webm',
      uploadUrl: 'https://r2.test/abc123.webm?signed=1',
      viewerUrl: 'https://record.test/v/abc123',
    });
    expect(r.effects).toEqual([
      {
        type: 'putBytes',
        uploadUrl: 'https://r2.test/abc123.webm?signed=1',
        blob,
        mimeType: 'video/webm',
      },
    ]);
  });

  it('CreateFailed → Failed + status + re-enables Start', () => {
    const r = transition(minting, {
      type: 'CreateFailed',
      reason: 'invalid_content_type',
    });
    expect(r.next).toEqual({
      kind: 'Failed',
      message: 'invalid_content_type',
    });
    expect(r.effects).toEqual([
      { type: 'setStatus', message: 'Upload rejected: invalid_content_type' },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });

  it('ignores PutOk (out of order)', () => {
    const r = transition(minting, { type: 'PutOk' });
    expect(r.next).toEqual(minting);
    expect(r.effects).toEqual([]);
  });
});

describe('transition: Uploading', () => {
  const blob = bytes(1024);
  const uploading = {
    kind: 'Uploading' as const,
    blob,
    mimeType: 'video/webm',
    uploadUrl: 'https://r2.test/abc123.webm?signed=1',
    viewerUrl: 'https://record.test/v/abc123',
  };

  it('PutOk → Done + shows result with the viewer URL + re-enables Start', () => {
    const r = transition(uploading, { type: 'PutOk' });
    expect(r.next).toEqual({
      kind: 'Done',
      viewerUrl: 'https://record.test/v/abc123',
    });
    expect(r.effects).toEqual([
      { type: 'setStatus', message: 'Done!' },
      { type: 'showResult', viewerUrl: 'https://record.test/v/abc123' },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });

  it('PutFailed → Failed + status carries the reason', () => {
    const r = transition(uploading, {
      type: 'PutFailed',
      reason: 'Upload to storage failed: HTTP 403',
    });
    expect(r.next).toEqual({
      kind: 'Failed',
      message: 'Upload to storage failed: HTTP 403',
    });
    expect(r.effects).toEqual([
      { type: 'setStatus', message: 'Upload to storage failed: HTTP 403' },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });
});

describe('transition: Done', () => {
  const done = {
    kind: 'Done' as const,
    viewerUrl: 'https://record.test/v/abc123',
  };

  it('CopyClicked → stays in Done + emits clipboard write with the viewer URL', () => {
    const r = transition(done, { type: 'CopyClicked' });
    expect(r.next).toEqual(done);
    expect(r.effects).toEqual([
      { type: 'copyToClipboard', text: 'https://record.test/v/abc123' },
    ]);
  });

  it('StartClicked → Starting + clears UI (allows re-recording)', () => {
    const r = transition(done, { type: 'StartClicked', audioEnabled: false, videoEnabled: false });
    expect(r.next).toEqual({ kind: 'Starting', videoEnabled: false });
    expect(r.effects).toEqual([
      { type: 'hideResult' },
      { type: 'setStatus', message: '' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'requestDisplayMedia' },
    ]);
  });
});

describe('transition: Failed', () => {
  const failed = { kind: 'Failed' as const, message: 'NotAllowedError' };

  it('StartClicked → Starting (allows retry after failure)', () => {
    const r = transition(failed, { type: 'StartClicked', audioEnabled: false, videoEnabled: false });
    expect(r.next).toEqual({ kind: 'Starting', videoEnabled: false });
    expect(r.effects).toEqual([
      { type: 'hideResult' },
      { type: 'setStatus', message: '' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'requestDisplayMedia' },
    ]);
  });

  it('ignores CopyClicked (no Done URL to copy)', () => {
    const r = transition(failed, { type: 'CopyClicked' });
    expect(r.next).toEqual(failed);
    expect(r.effects).toEqual([]);
  });
});

describe('transition: Idle (audioEnabled:true)', () => {
  it('StartClicked{audioEnabled:true} → RequestingMic + clears UI + requests user media', () => {
    const r = transition(initialState(), { type: 'StartClicked', audioEnabled: true, videoEnabled: false });
    expect(r.next).toEqual({ kind: 'RequestingMic', videoEnabled: false });
    expect(r.effects).toEqual([
      { type: 'hideResult' },
      { type: 'setStatus', message: '' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'requestUserMedia' },
    ]);
  });
});

describe('transition: RequestingMic', () => {
  const requesting = { kind: 'RequestingMic' as const, videoEnabled: false };

  it('UserMediaGranted → Starting{audioStream} + requests display media', () => {
    const r = transition(requesting, { type: 'UserMediaGranted', stream: fakeStream });
    expect(r.next).toEqual({ kind: 'Starting', audioStream: fakeStream, videoEnabled: false });
    expect(r.effects).toEqual([
      { type: 'requestDisplayMedia' },
    ]);
  });

  it('UserMediaFailed → Failed + status carries the reason + re-enables Start', () => {
    const r = transition(requesting, {
      type: 'UserMediaFailed',
      reason: 'Microphone access denied. Allow it in your browser, or turn off the mic toggle to record silently.',
    });
    expect(r.next).toEqual({
      kind: 'Failed',
      message:
        'Microphone access denied. Allow it in your browser, or turn off the mic toggle to record silently.',
    });
    expect(r.effects).toEqual([
      {
        type: 'setStatus',
        message:
          'Microphone access denied. Allow it in your browser, or turn off the mic toggle to record silently.',
      },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });

  it('ignores StopClicked', () => {
    const r = transition(requesting, { type: 'StopClicked' });
    expect(r.next).toEqual(requesting);
    expect(r.effects).toEqual([]);
  });

  it('ignores DisplayMediaGranted (cannot precede UserMediaGranted)', () => {
    const r = transition(requesting, { type: 'DisplayMediaGranted', stream: fakeStream });
    expect(r.next).toEqual(requesting);
    expect(r.effects).toEqual([]);
  });
});

describe('transition: Starting{audioStream}', () => {
  const startingWithAudio = { kind: 'Starting' as const, audioStream: fakeStream, videoEnabled: false };

  it('DisplayMediaGranted → Capturing + startRecording{stream, audioStream} + UI updates', () => {
    const screenStream = { id: 'screen' } as unknown as MediaStream;
    const r = transition(startingWithAudio, {
      type: 'DisplayMediaGranted',
      stream: screenStream,
    });
    expect(r.next).toEqual({ kind: 'Capturing' });
    expect(r.effects).toEqual([
      { type: 'startTimer' },
      { type: 'startRecording', stream: screenStream, audioStream: fakeStream, videoEnabled: false },
      { type: 'setStatus', message: 'Recording…' },
      { type: 'setButtons', startEnabled: false, stopEnabled: true },
    ]);
  });

  it('DisplayMediaFailed → Failed + releases the held mic stream', () => {
    const r = transition(startingWithAudio, {
      type: 'DisplayMediaFailed',
      reason: 'NotAllowedError — user dismissed',
    });
    expect(r.next).toEqual({
      kind: 'Failed',
      message: 'NotAllowedError — user dismissed',
    });
    expect(r.effects).toEqual([
      { type: 'releaseStream' },
      {
        type: 'setStatus',
        message: 'Could not start capture: NotAllowedError — user dismissed',
      },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });
});

describe('transition: videoEnabled threading', () => {
  it('Idle + StartClicked{a:false, v:true} → Starting{v:true} + requestDisplayMedia', () => {
    const r = transition(initialState(), { type: 'StartClicked', audioEnabled: false, videoEnabled: true });
    expect(r.next).toEqual({ kind: 'Starting', videoEnabled: true });
    expect(r.effects).toEqual([
      { type: 'hideResult' },
      { type: 'setStatus', message: '' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'requestDisplayMedia' },
    ]);
  });

  it('Idle + StartClicked{a:true, v:true} → RequestingMic{v:true} + requestUserMedia', () => {
    const r = transition(initialState(), { type: 'StartClicked', audioEnabled: true, videoEnabled: true });
    expect(r.next).toEqual({ kind: 'RequestingMic', videoEnabled: true });
    expect(r.effects).toEqual([
      { type: 'hideResult' },
      { type: 'setStatus', message: '' },
      { type: 'setButtons', startEnabled: false, stopEnabled: false },
      { type: 'requestUserMedia' },
    ]);
  });

  it('RequestingMic{v:true} + UserMediaGranted → Starting{audioStream, v:true} + requestDisplayMedia', () => {
    const requesting = { kind: 'RequestingMic' as const, videoEnabled: true };
    const r = transition(requesting, { type: 'UserMediaGranted', stream: fakeStream });
    expect(r.next).toEqual({ kind: 'Starting', audioStream: fakeStream, videoEnabled: true });
    expect(r.effects).toEqual([{ type: 'requestDisplayMedia' }]);
  });

  it('Starting{v:true} (no mic) + DisplayMediaGranted → Capturing + startRecording{stream, videoEnabled:true} (no audioStream)', () => {
    const starting = { kind: 'Starting' as const, videoEnabled: true };
    const screen = { id: 'screen' } as unknown as MediaStream;
    const r = transition(starting, { type: 'DisplayMediaGranted', stream: screen });
    expect(r.next).toEqual({ kind: 'Capturing' });
    expect(r.effects).toEqual([
      { type: 'startTimer' },
      { type: 'startRecording', stream: screen, videoEnabled: true },
      { type: 'setStatus', message: 'Recording…' },
      { type: 'setButtons', startEnabled: false, stopEnabled: true },
    ]);
  });

  it('Starting{audioStream, v:true} + DisplayMediaGranted → Capturing + startRecording{stream, audioStream, videoEnabled:true}', () => {
    const starting = { kind: 'Starting' as const, audioStream: fakeStream, videoEnabled: true };
    const screen = { id: 'screen' } as unknown as MediaStream;
    const r = transition(starting, { type: 'DisplayMediaGranted', stream: screen });
    expect(r.next).toEqual({ kind: 'Capturing' });
    expect(r.effects).toEqual([
      { type: 'startTimer' },
      { type: 'startRecording', stream: screen, audioStream: fakeStream, videoEnabled: true },
      { type: 'setStatus', message: 'Recording…' },
      { type: 'setButtons', startEnabled: false, stopEnabled: true },
    ]);
  });

  it('Starting{audioStream, v:true} + DisplayMediaFailed → Failed + releaseStream (camera held outside SM)', () => {
    // Camera lives in the adapter; the reducer never emits a "release camera"
    // effect. releaseStream is emitted because the held mic stream needs
    // cleanup; the camera stays held by the adapter (toggle still on).
    const starting = { kind: 'Starting' as const, audioStream: fakeStream, videoEnabled: true };
    const r = transition(starting, { type: 'DisplayMediaFailed', reason: 'NotAllowedError — user dismissed' });
    expect(r.next).toEqual({ kind: 'Failed', message: 'NotAllowedError — user dismissed' });
    expect(r.effects).toEqual([
      { type: 'releaseStream' },
      { type: 'setStatus', message: 'Could not start capture: NotAllowedError — user dismissed' },
      { type: 'setButtons', startEnabled: true, stopEnabled: false },
    ]);
  });
});

describe('full happy-path replay', () => {
  it('Idle → Starting → Capturing → Stopping → MintingUrl → Uploading → Done', () => {
    const blob = bytes(1024, 'video/webm;codecs=vp9');
    let s = initialState();

    s = transition(s, { type: 'StartClicked', audioEnabled: false, videoEnabled: false }).next;
    expect(s.kind).toBe('Starting');

    s = transition(s, { type: 'DisplayMediaGranted', stream: fakeStream }).next;
    expect(s.kind).toBe('Capturing');

    s = transition(s, { type: 'StopClicked' }).next;
    expect(s.kind).toBe('Stopping');

    s = transition(s, {
      type: 'RecorderStopped',
      blob,
      mimeType: 'video/webm;codecs=vp9',
    }).next;
    expect(s.kind).toBe('MintingUrl');

    s = transition(s, {
      type: 'CreateOk',
      slug: 'abc123',
      uploadUrl: 'https://r2.test/abc123.webm?signed=1',
      viewerUrl: 'https://record.test/v/abc123',
    }).next;
    expect(s.kind).toBe('Uploading');

    s = transition(s, { type: 'PutOk' }).next;
    expect(s).toEqual({
      kind: 'Done',
      viewerUrl: 'https://record.test/v/abc123',
    });
  });
});
