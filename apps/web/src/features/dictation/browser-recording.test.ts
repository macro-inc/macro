import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORDING_MS, startRecording } from './browser-recording';

vi.mock('./browser-volume', () => ({
  startMicrophoneVolume: () => ({ stop: vi.fn() }),
}));
const stopTrack = vi.fn();
const stream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;
const getUserMedia = vi.fn(async () => stream);
class Recorder {
  static latest: Recorder;
  static isTypeSupported = vi.fn((type: string) => type === 'audio/mp4');
  mimeType: string;
  state = 'inactive';
  ondataavailable?: (event: { data: Blob }) => void;
  onstop?: () => void;
  start = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['final bytes']) });
    this.onstop?.();
  });
  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    this.mimeType = options.mimeType!;
    Recorder.latest = this;
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubGlobal('MediaRecorder', Recorder);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browser audio recording', () => {
  it('chooses Safari MP4, includes final bytes, and releases the microphone', async () => {
    const session = new AbortController();
    const recording = await startRecording({
      signal: session.signal,
      onLevel: vi.fn(),
      onLimit: vi.fn(),
    });
    const audio = await recording.finish();
    expect(audio.type).toBe('audio/mp4');
    expect(audio.size).toBe(11);
    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('discards recorded bytes on cancellation', async () => {
    const session = new AbortController();
    const recording = await startRecording({
      signal: session.signal,
      onLevel: vi.fn(),
      onLimit: vi.fn(),
    });
    session.abort();
    await expect(recording.finish()).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(stopTrack).toHaveBeenCalled();
  });
  it('releases a microphone granted after cancellation', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((done) => {
          grant = done;
        })
    );
    const session = new AbortController();
    const pending = startRecording({
      signal: session.signal,
      onLevel: vi.fn(),
      onLimit: vi.fn(),
    });
    session.abort();
    grant(stream);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(stopTrack).toHaveBeenCalledOnce();
  });
  it('signals the duration limit without performing network I/O', async () => {
    const onLimit = vi.fn();
    const recording = await startRecording({
      signal: new AbortController().signal,
      onLevel: vi.fn(),
      onLimit,
    });
    vi.advanceTimersByTime(MAX_RECORDING_MS);
    expect(onLimit).toHaveBeenCalledOnce();
    recording.cancel();
  });
});
