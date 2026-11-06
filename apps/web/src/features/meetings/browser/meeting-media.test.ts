import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserMeetingMedia } from './meeting-media';

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
});
