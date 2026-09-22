import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requestVoiceMicrophone } from './microphone';

function track(kind = 'audio', readyState = 'live') {
  return { kind, readyState, stop: vi.fn() } as unknown as MediaStreamTrack;
}
function stream(...tracks: MediaStreamTrack[]) {
  return {
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getTracks: () => tracks,
  } as unknown as MediaStream;
}
const getUserMedia = vi.fn<() => Promise<MediaStream>>();
const enumerateDevices = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('navigator', {
    mediaDevices: { getUserMedia, enumerateDevices },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('browser voice microphone', () => {
  it('requests permission directly without gating on device enumeration', async () => {
    const audio = track();
    getUserMedia.mockResolvedValueOnce(stream(audio));
    const microphone = await requestVoiceMicrophone();
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    expect(enumerateDevices).not.toHaveBeenCalled();
    expect(microphone.track).toBe(audio);
    microphone.stop();
    microphone.stop();
    expect(audio.stop).toHaveBeenCalledOnce();
  });

  it.each([
    ['NotAllowedError', 'Allow microphone access'],
    ['SecurityError', 'Allow microphone access'],
    ['NotFoundError', 'Connect or enable a microphone'],
    ['NotReadableError', 'Close other apps'],
    ['AbortError', 'Check your microphone and browser permissions'],
  ])('explains %s and leaves retry available', async (name, explanation) => {
    getUserMedia.mockRejectedValueOnce(
      new DOMException('Capture failed', name)
    );
    await expect(requestVoiceMicrophone()).rejects.toThrow(explanation);
    const audio = track();
    getUserMedia.mockResolvedValueOnce(stream(audio));
    const microphone = await requestVoiceMicrophone();
    expect(microphone.track).toBe(audio);
    microphone.stop();
  });

  it('explains insecure origins before attempting capture', async () => {
    vi.stubGlobal('isSecureContext', false);
    await expect(requestVoiceMicrophone()).rejects.toThrow(
      'HTTPS or localhost'
    );
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('explains browsers without media capture', async () => {
    vi.stubGlobal('navigator', {});
    await expect(requestVoiceMicrophone()).rejects.toThrow('current browser');
  });

  it('stops every captured track if the stream has no live audio', async () => {
    const audio = track('audio', 'ended');
    const video = track('video');
    getUserMedia.mockResolvedValueOnce(stream(audio, video));
    await expect(requestVoiceMicrophone()).rejects.toThrow(
      'did not provide audio'
    );
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(video.stop).toHaveBeenCalledOnce();
  });

  it('stops unexpected extra tracks while keeping the selected audio live', async () => {
    const audio = track();
    const extra = track();
    const video = track('video');
    getUserMedia.mockResolvedValueOnce(stream(audio, extra, video));
    const microphone = await requestVoiceMicrophone();
    expect(microphone.track).toBe(audio);
    expect(extra.stop).toHaveBeenCalledOnce();
    expect(video.stop).toHaveBeenCalledOnce();
    expect(audio.stop).not.toHaveBeenCalled();
    microphone.stop();
  });
});
