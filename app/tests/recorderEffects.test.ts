import { describe, it, expect, vi } from 'vitest';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — JSDoc-typed JS module shipped to the browser as well.
import { runEffect } from '../src/public/recorderEffects.js';

type Ports = {
  setStatus: ReturnType<typeof vi.fn>;
  setButtons: ReturnType<typeof vi.fn>;
  startTimer: ReturnType<typeof vi.fn>;
  stopTimer: ReturnType<typeof vi.fn>;
  showResult: ReturnType<typeof vi.fn>;
  hideResult: ReturnType<typeof vi.fn>;
  copyToClipboard: ReturnType<typeof vi.fn>;
  releaseStream: ReturnType<typeof vi.fn>;
  requestDisplay: ReturnType<typeof vi.fn>;
  requestUser: ReturnType<typeof vi.fn>;
  startCapture: ReturnType<typeof vi.fn>;
  stopCapture: ReturnType<typeof vi.fn>;
  mintUpload: ReturnType<typeof vi.fn>;
  putBytes: ReturnType<typeof vi.fn>;
  dispatch: ReturnType<typeof vi.fn>;
};

function makePorts(overrides: Partial<Ports> = {}): Ports {
  return {
    setStatus: vi.fn(),
    setButtons: vi.fn(),
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    showResult: vi.fn(),
    hideResult: vi.fn(),
    copyToClipboard: vi.fn(),
    releaseStream: vi.fn(),
    requestDisplay: vi.fn(),
    requestUser: vi.fn(),
    startCapture: vi.fn(),
    stopCapture: vi.fn(),
    mintUpload: vi.fn(),
    putBytes: vi.fn(),
    dispatch: vi.fn(),
    ...overrides,
  };
}

const fakeStream = { __id: 'screen' } as unknown as MediaStream;
const fakeAudio = { __id: 'audio' } as unknown as MediaStream;
const fakeBlob = new Blob([new Uint8Array(1)], { type: 'video/webm' });

describe('runEffect — synchronous DOM mutations', () => {
  it('setStatus calls ports.setStatus with the message', async () => {
    const ports = makePorts();
    await runEffect({ type: 'setStatus', message: 'Recording…' }, ports);
    expect(ports.setStatus).toHaveBeenCalledWith('Recording…');
    expect(ports.dispatch).not.toHaveBeenCalled();
  });

  it('setButtons calls ports.setButtons with both flags', async () => {
    const ports = makePorts();
    await runEffect(
      { type: 'setButtons', startEnabled: false, stopEnabled: true },
      ports,
    );
    expect(ports.setButtons).toHaveBeenCalledWith({
      startEnabled: false,
      stopEnabled: true,
    });
  });

  it('startTimer calls ports.startTimer', async () => {
    const ports = makePorts();
    await runEffect({ type: 'startTimer' }, ports);
    expect(ports.startTimer).toHaveBeenCalledTimes(1);
  });

  it('stopTimer calls ports.stopTimer', async () => {
    const ports = makePorts();
    await runEffect({ type: 'stopTimer' }, ports);
    expect(ports.stopTimer).toHaveBeenCalledTimes(1);
  });

  it('showResult calls ports.showResult with the viewer URL', async () => {
    const ports = makePorts();
    await runEffect(
      { type: 'showResult', viewerUrl: 'https://record.test/v/abc123' },
      ports,
    );
    expect(ports.showResult).toHaveBeenCalledWith(
      'https://record.test/v/abc123',
    );
  });

  it('hideResult calls ports.hideResult', async () => {
    const ports = makePorts();
    await runEffect({ type: 'hideResult' }, ports);
    expect(ports.hideResult).toHaveBeenCalledTimes(1);
  });

  it('copyToClipboard calls ports.copyToClipboard with the text', async () => {
    const ports = makePorts();
    await runEffect(
      { type: 'copyToClipboard', text: 'https://record.test/v/abc123' },
      ports,
    );
    expect(ports.copyToClipboard).toHaveBeenCalledWith(
      'https://record.test/v/abc123',
    );
  });

  it('releaseStream calls ports.releaseStream', async () => {
    const ports = makePorts();
    await runEffect({ type: 'releaseStream' }, ports);
    expect(ports.releaseStream).toHaveBeenCalledTimes(1);
  });
});

describe('runEffect — startRecording wires the TrackEnded callback', () => {
  it('calls ports.startCapture with stream, audioStream, videoEnabled, and onTrackEnded', async () => {
    const ports = makePorts();
    await runEffect(
      { type: 'startRecording', stream: fakeStream, audioStream: fakeAudio, videoEnabled: false },
      ports,
    );
    expect(ports.startCapture).toHaveBeenCalledTimes(1);
    const args = ports.startCapture.mock.calls[0];
    expect(args[0]).toBe(fakeStream);
    expect(args[1]).toBe(fakeAudio);
    expect(args[2]).toBe(false);
    expect(typeof args[3]).toBe('function');
  });

  it('passes undefined audioStream when omitted from the effect', async () => {
    const ports = makePorts();
    await runEffect({ type: 'startRecording', stream: fakeStream, videoEnabled: false }, ports);
    expect(ports.startCapture.mock.calls[0][1]).toBeUndefined();
  });

  it('the onTrackEnded callback dispatches TrackEnded when invoked', async () => {
    const ports = makePorts();
    await runEffect({ type: 'startRecording', stream: fakeStream, videoEnabled: false }, ports);
    const onTrackEnded = ports.startCapture.mock.calls[0][3] as () => void;
    onTrackEnded();
    expect(ports.dispatch).toHaveBeenCalledWith({ type: 'TrackEnded' });
  });

  it('forwards videoEnabled:true to startCapture', async () => {
    const ports = makePorts();
    await runEffect({ type: 'startRecording', stream: fakeStream, videoEnabled: true }, ports);
    expect(ports.startCapture.mock.calls[0][2]).toBe(true);
  });
});

describe('runEffect — requestDisplayMedia translates outcomes to SM events', () => {
  it('ok outcome dispatches DisplayMediaGranted with the stream', async () => {
    const ports = makePorts({
      requestDisplay: vi
        .fn()
        .mockResolvedValue({ kind: 'ok', stream: fakeStream }),
    });
    await runEffect({ type: 'requestDisplayMedia' }, ports);
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'DisplayMediaGranted',
      stream: fakeStream,
    });
  });

  it('failed outcome dispatches DisplayMediaFailed with the reason', async () => {
    const ports = makePorts({
      requestDisplay: vi
        .fn()
        .mockResolvedValue({ kind: 'failed', reason: 'NotAllowedError — denied' }),
    });
    await runEffect({ type: 'requestDisplayMedia' }, ports);
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'DisplayMediaFailed',
      reason: 'NotAllowedError — denied',
    });
  });
});

describe('runEffect — requestUserMedia translates outcomes to SM events', () => {
  it('ok outcome dispatches UserMediaGranted with the stream', async () => {
    const ports = makePorts({
      requestUser: vi
        .fn()
        .mockResolvedValue({ kind: 'ok', stream: fakeAudio }),
    });
    await runEffect({ type: 'requestUserMedia' }, ports);
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'UserMediaGranted',
      stream: fakeAudio,
    });
  });

  it('failed outcome dispatches UserMediaFailed with the reason', async () => {
    const ports = makePorts({
      requestUser: vi
        .fn()
        .mockResolvedValue({ kind: 'failed', reason: 'No microphone found.' }),
    });
    await runEffect({ type: 'requestUserMedia' }, ports);
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'UserMediaFailed',
      reason: 'No microphone found.',
    });
  });
});

describe('runEffect — stopRecording dispatches RecorderStopped with blob+mimeType', () => {
  it('forwards the resolved blob and mimeType verbatim', async () => {
    const ports = makePorts({
      stopCapture: vi
        .fn()
        .mockResolvedValue({ blob: fakeBlob, mimeType: 'video/webm;codecs=vp9' }),
    });
    await runEffect({ type: 'stopRecording' }, ports);
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'RecorderStopped',
      blob: fakeBlob,
      mimeType: 'video/webm;codecs=vp9',
    });
  });
});

describe('runEffect — mintUpload translates outcomes to SM events', () => {
  it('ok outcome dispatches CreateOk with slug, uploadUrl, viewerUrl', async () => {
    const ports = makePorts({
      mintUpload: vi.fn().mockResolvedValue({
        kind: 'ok',
        slug: 'abc123',
        uploadUrl: 'https://r2.test/abc123.webm?sig=1',
        viewerUrl: 'https://record.test/v/abc123',
      }),
    });
    await runEffect(
      { type: 'mintUpload', mimeType: 'video/webm', sizeBytes: 1024 },
      ports,
    );
    expect(ports.mintUpload).toHaveBeenCalledWith({
      mimeType: 'video/webm',
      sizeBytes: 1024,
    });
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'CreateOk',
      slug: 'abc123',
      uploadUrl: 'https://r2.test/abc123.webm?sig=1',
      viewerUrl: 'https://record.test/v/abc123',
    });
  });

  it('failed outcome dispatches CreateFailed with the reason', async () => {
    const ports = makePorts({
      mintUpload: vi
        .fn()
        .mockResolvedValue({ kind: 'failed', reason: 'invalid_content_type' }),
    });
    await runEffect(
      { type: 'mintUpload', mimeType: 'video/mp4', sizeBytes: 1 },
      ports,
    );
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'CreateFailed',
      reason: 'invalid_content_type',
    });
  });
});

describe('runEffect — putBytes translates outcomes to SM events', () => {
  it('ok outcome dispatches PutOk', async () => {
    const ports = makePorts({
      putBytes: vi.fn().mockResolvedValue({ kind: 'ok' }),
    });
    await runEffect(
      {
        type: 'putBytes',
        uploadUrl: 'https://r2.test/abc.webm?sig=1',
        blob: fakeBlob,
        mimeType: 'video/webm',
      },
      ports,
    );
    expect(ports.putBytes).toHaveBeenCalledWith({
      uploadUrl: 'https://r2.test/abc.webm?sig=1',
      blob: fakeBlob,
      mimeType: 'video/webm',
    });
    expect(ports.dispatch).toHaveBeenCalledWith({ type: 'PutOk' });
  });

  it('failed outcome dispatches PutFailed with the reason', async () => {
    const ports = makePorts({
      putBytes: vi.fn().mockResolvedValue({
        kind: 'failed',
        reason: 'Upload to storage failed: HTTP 403',
      }),
    });
    await runEffect(
      {
        type: 'putBytes',
        uploadUrl: 'https://r2.test/abc.webm?sig=1',
        blob: fakeBlob,
        mimeType: 'video/webm',
      },
      ports,
    );
    expect(ports.dispatch).toHaveBeenCalledWith({
      type: 'PutFailed',
      reason: 'Upload to storage failed: HTTP 403',
    });
  });
});

describe('runEffect — exhaustiveness guard', () => {
  it('throws on an unknown effect type', async () => {
    const ports = makePorts();
    await expect(
      runEffect({ type: 'thisDoesNotExist' } as never, ports),
    ).rejects.toThrow(/unknown effect/i);
  });
});
