import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — JSDoc-typed JS module shipped to the browser as well.
import { createCapture, pickMimeType } from '../src/public/recorderCapture.js';

// --- test doubles ----------------------------------------------------------

type FakeTrack = {
  kind: 'video' | 'audio';
  _stopped: boolean;
  onended: (() => void) | null;
  stop(): void;
};

function makeTrack(kind: 'video' | 'audio'): FakeTrack {
  return {
    kind,
    _stopped: false,
    onended: null,
    stop() {
      this._stopped = true;
    },
  };
}

interface FakeStream {
  _tracks: FakeTrack[];
  getTracks(): FakeTrack[];
  getAudioTracks(): FakeTrack[];
  addTrack(t: FakeTrack): void;
}

function makeStream(tracks: FakeTrack[]): FakeStream {
  return {
    _tracks: [...tracks],
    getTracks() {
      return [...this._tracks];
    },
    getAudioTracks() {
      return this._tracks.filter((t) => t.kind === 'audio');
    },
    addTrack(t) {
      this._tracks.push(t);
    },
  };
}

// FakeMediaRecorder gives the test explicit control over chunk emission and
// stop completion — real MediaRecorder fires onstop asynchronously after stop().
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static reset() {
    FakeMediaRecorder.instances = [];
  }

  stream: FakeStream;
  options: { mimeType: string };
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  // Browser-normalised mimeType — deliberately different from the constructor
  // input, so tests can verify Capture pins the input value, not this one.
  mimeType: string;

  constructor(stream: FakeStream, options: { mimeType: string }) {
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType + ';browserNormalised=1';
    FakeMediaRecorder.instances.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    if (this.onstop) this.onstop();
  }

  _emitChunk(data: Blob) {
    if (this.ondataavailable) this.ondataavailable({ data });
  }
}

// --- pickMimeType ----------------------------------------------------------

describe('pickMimeType', () => {
  let supported: Set<string>;

  beforeEach(() => {
    supported = new Set();
    vi.stubGlobal('MediaRecorder', {
      isTypeSupported: (m: string) => supported.has(m),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hasAudio + vp9-opus supported → vp9,opus', () => {
    supported.add('video/webm;codecs=vp9,opus');
    expect(pickMimeType(true)).toBe('video/webm;codecs=vp9,opus');
  });

  it('hasAudio + only vp8-opus supported → vp8,opus', () => {
    supported.add('video/webm;codecs=vp8,opus');
    expect(pickMimeType(true)).toBe('video/webm;codecs=vp8,opus');
  });

  it('hasAudio + nothing typed supported → plain video/webm', () => {
    expect(pickMimeType(true)).toBe('video/webm');
  });

  it('no audio + vp9 supported → vp9', () => {
    supported.add('video/webm;codecs=vp9');
    expect(pickMimeType(false)).toBe('video/webm;codecs=vp9');
  });

  it('no audio + nothing typed supported → plain video/webm', () => {
    expect(pickMimeType(false)).toBe('video/webm');
  });
});

// --- requestDisplay --------------------------------------------------------

describe('createCapture.requestDisplay', () => {
  it('returns failed/unavailable when navigator.mediaDevices is missing', async () => {
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestDisplay();
    expect(r.kind).toBe('failed');
    expect((r as { reason: string }).reason).toMatch(/getDisplayMedia is unavailable/);
  });

  it('returns failed/unavailable when getDisplayMedia is missing', async () => {
    const capture = createCapture({
      navigator: { mediaDevices: {} },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestDisplay();
    expect(r.kind).toBe('failed');
    expect((r as { reason: string }).reason).toMatch(/getDisplayMedia is unavailable/);
  });

  it('returns failed with "<Name> — <message>" when getDisplayMedia throws', async () => {
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getDisplayMedia: async () => {
            const err = new Error('user denied prompt');
            err.name = 'NotAllowedError';
            throw err;
          },
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestDisplay();
    expect(r).toEqual({ kind: 'failed', reason: 'NotAllowedError — user denied prompt' });
  });

  it('falls back to "Error" when the thrown value has no name', async () => {
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getDisplayMedia: async () => {
            // eslint-disable-next-line no-throw-literal
            throw 'oops';
          },
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestDisplay();
    expect(r).toEqual({ kind: 'failed', reason: 'Error — oops' });
  });

  it('returns ok with the stream on success and requests video at 30fps without audio', async () => {
    const stream = makeStream([makeTrack('video')]);
    const calls: unknown[] = [];
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getDisplayMedia: async (constraints: unknown) => {
            calls.push(constraints);
            return stream;
          },
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestDisplay();
    expect(r).toEqual({ kind: 'ok', stream });
    expect(calls).toEqual([{ video: { frameRate: 30 }, audio: false }]);
  });
});

// --- requestUser -----------------------------------------------------------

describe('createCapture.requestUser', () => {
  it('returns failed/unavailable when getUserMedia is missing', async () => {
    const capture = createCapture({
      navigator: { mediaDevices: {} },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestUser();
    expect(r.kind).toBe('failed');
    expect((r as { reason: string }).reason).toMatch(/Microphone API unavailable/);
  });

  it('NotFoundError → "No microphone found" message', async () => {
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            const err = new Error('no device');
            err.name = 'NotFoundError';
            throw err;
          },
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestUser();
    expect(r).toEqual({
      kind: 'failed',
      reason: 'No microphone found. Turn off the mic toggle to record silently.',
    });
  });

  it('NotAllowedError → "Microphone access denied" message', async () => {
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            const err = new Error('denied');
            err.name = 'NotAllowedError';
            throw err;
          },
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestUser();
    expect(r.kind).toBe('failed');
    expect((r as { reason: string }).reason).toMatch(/Microphone access denied/);
  });

  it('SecurityError → same "denied" message as NotAllowedError', async () => {
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            const err = new Error('insecure');
            err.name = 'SecurityError';
            throw err;
          },
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestUser();
    expect(r.kind).toBe('failed');
    expect((r as { reason: string }).reason).toMatch(/Microphone access denied/);
  });

  it('other errors → "Microphone error: <name> — <detail>"', async () => {
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getUserMedia: async () => {
            const err = new Error('hardware fault');
            err.name = 'AbortError';
            throw err;
          },
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestUser();
    expect(r).toEqual({
      kind: 'failed',
      reason: 'Microphone error: AbortError — hardware fault',
    });
  });

  it('returns ok with the stream and remembers it for release()', async () => {
    const audioTrack = makeTrack('audio');
    const audioStream = makeStream([audioTrack]);
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getUserMedia: async () => audioStream,
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const r = await capture.requestUser();
    expect(r).toEqual({ kind: 'ok', stream: audioStream });

    // Critical: if start() never fires (e.g. screen-share denied next),
    // release() must still stop the held audio track. The browser tab's
    // mic indicator depends on this.
    capture.release();
    expect(audioTrack._stopped).toBe(true);
  });
});

// --- start + stop lifecycle ------------------------------------------------

describe('createCapture lifecycle', () => {
  beforeEach(() => {
    FakeMediaRecorder.reset();
  });

  it('start constructs MediaRecorder with the picked mimeType and starts recording', () => {
    const screenStream = makeStream([makeTrack('video')]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: (hasAudio: boolean) =>
        hasAudio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9',
    });
    capture.start(screenStream as unknown as MediaStream);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    const mr = FakeMediaRecorder.instances[0];
    expect(mr.options).toEqual({ mimeType: 'video/webm;codecs=vp9' });
    expect(mr.state).toBe('recording');
    expect(mr.stream).toBe(screenStream);
  });

  it('start merges audio tracks from optAudioStream into the screen stream', () => {
    const videoTrack = makeTrack('video');
    const audioTrack = makeTrack('audio');
    const screenStream = makeStream([videoTrack]);
    const audioStream = makeStream([audioTrack]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm;codecs=vp9,opus',
    });
    capture.start(
      screenStream as unknown as MediaStream,
      audioStream as unknown as MediaStream,
    );
    expect(screenStream.getTracks().map((t) => t.kind)).toEqual(['video', 'audio']);
    // The MediaRecorder receives the merged screen stream, not the audio stream.
    expect(FakeMediaRecorder.instances[0].stream).toBe(screenStream);
  });

  it('start picks the audio mimeType when an audioStream is held from prior requestUser', async () => {
    const audioStream = makeStream([makeTrack('audio')]);
    const screenStream = makeStream([makeTrack('video')]);
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getUserMedia: async () => audioStream,
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: (hasAudio: boolean) =>
        hasAudio ? 'video/webm;codecs=vp9,opus' : 'video/webm;codecs=vp9',
    });
    await capture.requestUser(); // remembers audioStream
    capture.start(screenStream as unknown as MediaStream); // no explicit audioStream arg
    expect(FakeMediaRecorder.instances[0].options.mimeType).toBe('video/webm;codecs=vp9,opus');
  });

  it('start wires onTrackEnded against every screen-stream track', () => {
    const onTrackEnded = vi.fn();
    const videoTrack = makeTrack('video');
    const screenStream = makeStream([videoTrack]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    capture.start(screenStream as unknown as MediaStream, undefined, onTrackEnded);
    expect(videoTrack.onended).toBeTypeOf('function');
    videoTrack.onended!();
    expect(onTrackEnded).toHaveBeenCalledOnce();
  });

  it('start wires onTrackEnded on merged audio tracks (i.e. AFTER the merge)', () => {
    // Load-bearing ordering invariant: if onended were wired BEFORE the
    // merge, audioTrack.onended would still be null after start() — and the
    // user unplugging their mic mid-recording would not stop the Capture.
    const onTrackEnded = vi.fn();
    const audioTrack = makeTrack('audio');
    const screenStream = makeStream([makeTrack('video')]);
    const audioStream = makeStream([audioTrack]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm;codecs=vp9,opus',
    });
    capture.start(
      screenStream as unknown as MediaStream,
      audioStream as unknown as MediaStream,
      onTrackEnded,
    );
    expect(audioTrack.onended).toBeTypeOf('function');
    audioTrack.onended!();
    expect(onTrackEnded).toHaveBeenCalledOnce();
  });

  it('start without an onTrackEnded does not throw and leaves track.onended null', () => {
    const videoTrack = makeTrack('video');
    const screenStream = makeStream([videoTrack]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    capture.start(screenStream as unknown as MediaStream);
    expect(videoTrack.onended).toBeNull();
  });

  it('stop resolves with chunks→Blob carrying the PINNED mimeType, not the browser-normalised one', async () => {
    const screenStream = makeStream([makeTrack('video')]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm;codecs=vp9',
    });
    capture.start(screenStream as unknown as MediaStream);
    const mr = FakeMediaRecorder.instances[0];
    // Sanity: the FakeMediaRecorder reports a different mimeType post-construct
    expect(mr.mimeType).toBe('video/webm;codecs=vp9;browserNormalised=1');

    // Chunks arrive during recording (real browser fires ondataavailable
    // periodically; our fake gives the test explicit control).
    mr._emitChunk(new Blob(['chunk-a'], { type: 'video/webm' }));
    mr._emitChunk(new Blob(['chunk-b'], { type: 'video/webm' }));

    const result = await capture.stop();
    // Pinned mimeType — what the SERVER pins via ALLOWED_MIME — wins.
    expect(result.mimeType).toBe('video/webm;codecs=vp9');
    expect(result.blob.type).toBe('video/webm;codecs=vp9');
    // Two chunks of length 7 each ('chunk-a', 'chunk-b')
    expect(result.blob.size).toBe(14);
  });

  it('stop without a prior start resolves with an empty blob (SM treats as Failed)', async () => {
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    const result = await capture.stop();
    expect(result.blob.size).toBe(0);
    expect(result.mimeType).toBe('video/webm');
  });
});

// --- release ---------------------------------------------------------------

describe('createCapture.release', () => {
  beforeEach(() => {
    FakeMediaRecorder.reset();
  });

  it('stops every track on both held streams', () => {
    const videoTrack = makeTrack('video');
    const audioTrack = makeTrack('audio');
    const screenStream = makeStream([videoTrack]);
    const audioStream = makeStream([audioTrack]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm;codecs=vp9,opus',
    });
    capture.start(
      screenStream as unknown as MediaStream,
      audioStream as unknown as MediaStream,
    );
    // After start(), the audio track has been added to screenStream — the
    // double-stop is a spec-defined no-op (relevant for the .release() path).
    capture.release();
    expect(videoTrack._stopped).toBe(true);
    expect(audioTrack._stopped).toBe(true);
  });

  it('is idempotent — double release is safe', () => {
    const videoTrack = makeTrack('video');
    const screenStream = makeStream([videoTrack]);
    const capture = createCapture({
      navigator: {},
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    capture.start(screenStream as unknown as MediaStream);
    expect(() => {
      capture.release();
      capture.release();
    }).not.toThrow();
  });

  it('cleans up an audioStream remembered from requestUser even if start() never fires', async () => {
    const audioTrack = makeTrack('audio');
    const audioStream = makeStream([audioTrack]);
    const capture = createCapture({
      navigator: {
        mediaDevices: {
          getUserMedia: async () => audioStream,
        },
      },
      MediaRecorderCtor: FakeMediaRecorder as unknown as typeof MediaRecorder,
      pickMimeType: () => 'video/webm',
    });
    await capture.requestUser();
    capture.release();
    expect(audioTrack._stopped).toBe(true);
  });
});
