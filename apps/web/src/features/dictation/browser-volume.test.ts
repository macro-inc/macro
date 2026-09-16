import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startMicrophoneVolume } from './browser-volume';
import { microphoneLevel } from './core/volume';

let amplitude = 0;
const track = { stop: vi.fn() };
const input = { getTracks: () => [track] } as unknown as MediaStream;
const getUserMedia = vi.fn(async () => input);
const analyser = {
  fftSize: 0,
  getFloatTimeDomainData: (buffer: Float32Array) => {
    // Alternate polarity like an AC signal; energy reflects the amplitude.
    buffer.forEach((_, index) => {
      buffer[index] = index % 2 ? amplitude : -amplitude;
    });
  },
  disconnect: vi.fn(),
};
const source = { connect: vi.fn(), disconnect: vi.fn() };
class Audio {
  static last: Audio;
  resume = vi.fn(async () => {});
  close = vi.fn(async () => {});
  createAnalyser = vi.fn(() => analyser);
  createMediaStreamSource = vi.fn(() => source);
  constructor() {
    Audio.last = this;
  }
}

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  amplitude = 0;
  getUserMedia.mockResolvedValue(input);
  vi.stubGlobal('AudioContext', Audio);
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('microphone volume', () => {
  it('leaves a supplied recording stream owned by the recorder', async () => {
    const meter = startMicrophoneVolume(vi.fn(), vi.fn(), input);
    await settle();
    meter.stop();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
    expect(Audio.last.close).toHaveBeenCalledOnce();
  });

  it('maps silence, quiet and loud PCM to a fixed bounded scale', () => {
    expect(microphoneLevel(new Float32Array(8))).toBe(0);
    expect(microphoneLevel(new Float32Array(8).fill(0.0001))).toBe(0);
    const quiet = microphoneLevel(new Float32Array(8).fill(0.01));
    const loud = microphoneLevel(new Float32Array(8).fill(0.1));
    expect(quiet).toBeGreaterThan(0);
    expect(loud).toBeGreaterThan(quiet);
    expect(microphoneLevel(new Float32Array(8).fill(1))).toBe(1);
  });

  it('emits measured volume history including pauses, without playing audio', async () => {
    const onLevel = vi.fn();
    const meter = startMicrophoneVolume(onLevel, vi.fn());
    await settle();
    vi.advanceTimersByTime(200);
    amplitude = 0.1;
    vi.advanceTimersByTime(200);
    amplitude = 0.01;
    vi.advanceTimersByTime(200);
    amplitude = 0;
    vi.advanceTimersByTime(200);
    const levels = onLevel.mock.calls.map(([level]) => level);
    expect(levels).toHaveLength(4);
    expect(levels[0]).toBe(0);
    expect(levels[1]).toBeGreaterThan(levels[2]);
    expect(levels[2]).toBeGreaterThan(0);
    expect(levels[3]).toBe(0);
    expect(source.connect).toHaveBeenCalledExactlyOnceWith(analyser);
    meter.stop();
    vi.advanceTimersByTime(1000);
    expect(onLevel).toHaveBeenCalledTimes(4);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Audio.last.close).toHaveBeenCalledOnce();
    expect(source.disconnect).toHaveBeenCalledOnce();
  });

  it('stops a microphone granted after cancellation instead of leaking it', async () => {
    let grant!: (stream: MediaStream) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          grant = resolve;
        })
    );
    const onLevel = vi.fn();
    const meter = startMicrophoneVolume(onLevel, vi.fn());
    await settle();
    meter.stop();
    grant(input);
    await settle();
    vi.advanceTimersByTime(1000);
    expect(track.stop).toHaveBeenCalledOnce();
    expect(Audio.last.createMediaStreamSource).not.toHaveBeenCalled();
    expect(onLevel).not.toHaveBeenCalled();
  });

  it('reports permission failure and closes its audio context', async () => {
    getUserMedia.mockRejectedValueOnce(new Error('Permission denied'));
    const onError = vi.fn();
    startMicrophoneVolume(vi.fn(), onError);
    await settle();
    expect(onError).toHaveBeenCalledOnce();
    expect(Audio.last.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
