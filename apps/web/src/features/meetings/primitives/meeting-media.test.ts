import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createMeetingMedia, type MeetingMediaAccess } from './meeting-media';

function stream() {
  const stop = vi.fn();
  return {
    value: { getTracks: () => [{ stop }] } as unknown as MediaStream,
    stop,
  };
}

function setup(request: MeetingMediaAccess['request']) {
  return createRoot((dispose) => ({
    media: createMeetingMedia({ request }),
    dispose,
  }));
}

describe('prejoin media', () => {
  it('requests both permissions, previews only enabled devices, and releases them', async () => {
    const microphone = stream();
    const cameraPermission = stream();
    const cameraPreview = stream();
    const request = vi
      .fn()
      .mockResolvedValueOnce(microphone.value)
      .mockResolvedValueOnce(cameraPermission.value)
      .mockResolvedValueOnce(cameraPreview.value);
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      expect(request.mock.calls).toEqual([
        [{ audio: true, video: false }],
        [{ audio: false, video: true }],
      ]);
      expect(cameraPermission.stop).toHaveBeenCalledOnce();
      expect(microphone.stop).not.toHaveBeenCalled();
      expect(media.video()).toBeUndefined();
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.video()).toBe(cameraPreview.value));
      media.release();
      expect(cameraPreview.stop).toHaveBeenCalledOnce();
      expect(microphone.stop).toHaveBeenCalledOnce();
      expect(media.video()).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('keeps camera setup available after microphone permission is denied', async () => {
    const camera = stream();
    const request = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(camera.value);
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      expect(request).toHaveBeenCalledTimes(2);
      expect(media.microphoneEnabled()).toBe(false);
      expect(media.pending()).toBe(false);
      expect(media.errors()[0]).toContain('Microphone access is blocked');
    } finally {
      dispose();
    }
  });

  it.each(['release', 'dispose'] as const)(
    'stops a late permission result after %s without requesting another device',
    async (action) => {
      const microphone = stream();
      let resolve!: (value: MediaStream) => void;
      const request = vi.fn(
        () =>
          new Promise<MediaStream>((done) => {
            resolve = done;
          })
      );
      const { media, dispose } = setup(request);
      const preparing = media.prepare();
      if (action === 'dispose') dispose();
      else media.release();
      resolve(microphone.value);
      await preparing;
      expect(microphone.stop).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
      expect(media.pending()).toBe(false);
      dispose();
    }
  );
});
