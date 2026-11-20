import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserMeetingMedia, inputLevel } from './meeting-media';

describe('browserMeetingMedia', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('rejects with NotSupportedError when the webview exposes no media devices', async () => {
    vi.stubGlobal('navigator', { mediaDevices: undefined });

    await expect(
      browserMeetingMedia.request({ audio: true, video: false })
    ).rejects.toMatchObject({ name: 'NotSupportedError' });
    await expect(browserMeetingMedia.enumerate?.()).rejects.toMatchObject({
      name: 'NotSupportedError',
    });
  });

  it('maps silence to 0 and full-scale input to 1', () => {
    expect(inputLevel(new Float32Array(64))).toBe(0);
    expect(inputLevel(new Float32Array(64).fill(1))).toBe(1);
    // -30 dBFS sits halfway across the 60 dB range.
    expect(inputLevel(new Float32Array(64).fill(10 ** (-30 / 20)))).toBeCloseTo(
      0.5
    );
  });
});
