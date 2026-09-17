import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_RECORDING_CHUNKS, RECORDING_CHUNK_MS } from '../core/recording';
import { AudioRecorder } from './audio-recorder';

const stopTrack = vi.fn();
const stream = {
  getTracks: () => [{ stop: stopTrack }],
} as unknown as MediaStream;
const getUserMedia = vi.fn(async () => stream);

/** Constant analyser output; 0 is silence and 255 saturates the meter. */
let frequencyByte = 0;
const frames: FrameRequestCallback[] = [];

class FakeAudioContext {
  state = 'running';
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {
    this.state = 'closed';
  });
  createAnalyser = () => ({
    fftSize: 0,
    minDecibels: 0,
    maxDecibels: 0,
    smoothingTimeConstant: 0,
    frequencyBinCount: 64,
    getByteFrequencyData: (buffer: Uint8Array) => buffer.fill(frequencyByte),
  });
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
}

class FakeMediaRecorder {
  static latest: FakeMediaRecorder | undefined;
  static isTypeSupported = vi.fn((type: string) => type === 'audio/mp4');
  mimeType: string;
  state: RecordingState = 'inactive';
  timeslice = 0;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onerror: (() => void) | null = null;
  onstop: (() => void) | null = null;
  start = vi.fn((timeslice: number) => {
    this.state = 'recording';
    this.timeslice = timeslice;
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['final']) });
    this.onstop?.();
  });
  constructor(_stream: MediaStream, options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? '';
    FakeMediaRecorder.latest = this;
  }
  chunk(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) });
  }
}

const latest = () => {
  const media = FakeMediaRecorder.latest;
  if (!media) throw new Error('no MediaRecorder was constructed');
  return media;
};

function callbacks() {
  return {
    onLevel: vi.fn<(level: number) => void>(),
    onRecording: vi.fn<(audio: Blob) => void>(),
    onLimit: vi.fn<() => void>(),
    onError: vi.fn<(error: Error) => void>(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  frequencyByte = 0;
  frames.length = 0;
  FakeMediaRecorder.latest = undefined;
  FakeMediaRecorder.isTypeSupported.mockImplementation(
    (type: string) => type === 'audio/mp4'
  );
  getUserMedia.mockResolvedValue(stream);
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('requestAnimationFrame', (frame: FrameRequestCallback) => {
    frames.push(frame);
    return frames.length;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

describe('AudioRecorder', () => {
  it('reports support only with a secure context and a recordable format', () => {
    expect(AudioRecorder.isSupported()).toBe(true);
    FakeMediaRecorder.isTypeSupported.mockReturnValue(false);
    expect(AudioRecorder.isSupported()).toBe(false);
    FakeMediaRecorder.isTypeSupported.mockReturnValue(true);
    vi.stubGlobal('isSecureContext', false);
    expect(AudioRecorder.isSupported()).toBe(false);
  });

  it('collects chunks, meters each one, and delivers the recording on stop', async () => {
    frequencyByte = 255;
    const sinks = callbacks();
    const recorder = new AudioRecorder(sinks);
    await recorder.start();
    const media = latest();
    expect(media.timeslice).toBe(RECORDING_CHUNK_MS);
    expect(media.mimeType).toBe('audio/mp4');

    media.chunk('one');
    frequencyByte = 0;
    for (const frame of frames.splice(0)) frame(0);
    media.chunk('two');
    expect(sinks.onLevel.mock.calls.map(([level]) => level)).toEqual([1, 0]);

    recorder.stop();
    expect(sinks.onRecording).toHaveBeenCalledOnce();
    const audio = sinks.onRecording.mock.calls[0][0];
    expect(audio.type).toBe('audio/mp4');
    expect(audio.size).toBe('one'.length + 'two'.length + 'final'.length);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recorder.recording).toBe(false);
    expect(sinks.onError).not.toHaveBeenCalled();
    expect(sinks.onLimit).not.toHaveBeenCalled();
  });

  it('discards audio and releases the microphone on cancel', async () => {
    const sinks = callbacks();
    const recorder = new AudioRecorder(sinks);
    await recorder.start();
    latest().chunk('secret');
    recorder.cancel();
    expect(latest().stop).toHaveBeenCalledOnce();
    expect(sinks.onRecording).not.toHaveBeenCalled();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recorder.recording).toBe(false);
  });

  it('releases a microphone granted after cancellation', async () => {
    let grant!: (value: MediaStream) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        })
    );
    const recorder = new AudioRecorder(callbacks());
    const starting = recorder.start();
    recorder.cancel();
    grant(stream);
    await starting;
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recorder.recording).toBe(false);
    expect(FakeMediaRecorder.latest).toBeUndefined();
  });

  it('rejects start when the microphone is unavailable', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    const sinks = callbacks();
    const recorder = new AudioRecorder(sinks);
    await expect(recorder.start()).rejects.toThrow('Permission denied');
    expect(recorder.recording).toBe(false);
    expect(sinks.onError).not.toHaveBeenCalled();
  });

  it('stops itself at the duration cap and still delivers the recording', async () => {
    const sinks = callbacks();
    const recorder = new AudioRecorder(sinks);
    await recorder.start();
    const media = latest();
    for (let index = 0; index < MAX_RECORDING_CHUNKS; index++) media.chunk('.');
    expect(sinks.onLimit).toHaveBeenCalledOnce();
    expect(media.stop).toHaveBeenCalledOnce();
    expect(sinks.onRecording).toHaveBeenCalledOnce();
    expect(sinks.onLevel).toHaveBeenCalledTimes(MAX_RECORDING_CHUNKS);
    media.chunk('late');
    expect(sinks.onLevel).toHaveBeenCalledTimes(MAX_RECORDING_CHUNKS);
  });

  it('reports capture failures once and releases the microphone', async () => {
    const sinks = callbacks();
    const recorder = new AudioRecorder(sinks);
    await recorder.start();
    const media = latest();
    media.onerror?.();
    media.onerror?.();
    expect(sinks.onError).toHaveBeenCalledOnce();
    expect(sinks.onError.mock.calls[0][0].message).toMatch(/recording failed/i);
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(sinks.onRecording).not.toHaveBeenCalled();
  });

  it('lets only one recorder hold the microphone', async () => {
    const first = callbacks();
    const second = callbacks();
    const one = new AudioRecorder(first);
    await one.start();
    const two = new AudioRecorder(second);
    await two.start();
    expect(one.recording).toBe(false);
    expect(two.recording).toBe(true);
    expect(first.onRecording).not.toHaveBeenCalled();
    two.stop();
    expect(second.onRecording).toHaveBeenCalledOnce();
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  it('drops chunks when running as a meter only', async () => {
    const sinks = callbacks();
    const recorder = new AudioRecorder({ ...sinks, onRecording: undefined });
    await recorder.start();
    latest().chunk('discard');
    expect(sinks.onLevel).toHaveBeenCalledOnce();
    recorder.stop();
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(recorder.recording).toBe(false);
  });
});
