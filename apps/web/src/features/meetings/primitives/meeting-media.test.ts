import { createRoot } from 'solid-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FakeMediaStream,
  fakeMediaAccess,
  fakeTrack,
  stubMediaStream,
} from '../tests/fake-media';
import { createMeetingMedia, type MeetingMediaAccess } from './meeting-media';

function setup(request: MeetingMediaAccess['request']) {
  return createRoot((dispose) => ({
    media: createMeetingMedia({ request }),
    dispose,
  }));
}

const withTracks = (...tracks: MediaStreamTrack[]) =>
  new FakeMediaStream(tracks) as unknown as MediaStream;

describe('prejoin media', () => {
  beforeEach(stubMediaStream);

  it('asks for both permissions in one request and previews only enabled devices', async () => {
    const { request, tracks } = fakeMediaAccess();
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      expect(request).toHaveBeenCalledExactlyOnceWith({
        audio: true,
        video: expect.any(Object),
      });
      const [microphone, cameraPermission] = tracks;
      expect(cameraPermission.stop).toHaveBeenCalledOnce();
      expect(microphone.stop).not.toHaveBeenCalled();
      expect(media.video()).toBeUndefined();
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.video()).toBeDefined());
      const cameraPreview = tracks[2];
      media.release();
      expect(cameraPreview.stop).toHaveBeenCalledOnce();
      expect(microphone.stop).toHaveBeenCalledOnce();
      expect(media.video()).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('hands off live tracks of enabled devices without stopping them', async () => {
    const { request, tracks } = fakeMediaAccess();
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.video()).toBeDefined());
      const [microphone, , camera] = tracks;
      expect(media.handoff()).toEqual({ microphone, camera });
      expect(microphone.stop).not.toHaveBeenCalled();
      expect(camera.stop).not.toHaveBeenCalled();
      expect(media.video()).toBeUndefined();
      dispose();
      expect(microphone.stop).not.toHaveBeenCalled();
      expect(camera.stop).not.toHaveBeenCalled();
    } finally {
      dispose();
    }
  });

  it('does not hand off a device the user turned off', async () => {
    const { request, tracks } = fakeMediaAccess();
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      media.setMicrophoneEnabled(false);
      expect(media.handoff()).toBeUndefined();
      expect(tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(
        true
      );
    } finally {
      dispose();
    }
  });

  it('falls back to per-device requests so a microphone denial keeps camera setup', async () => {
    const camera = fakeTrack('video');
    const request = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(withTracks(camera));
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      expect(request).toHaveBeenCalledTimes(3);
      expect(media.microphoneEnabled()).toBe(false);
      expect(media.pending()).toBe(false);
      expect(media.errors()[0]).toContain('Microphone access is blocked');
    } finally {
      dispose();
    }
  });

  it('requests a device the combined grant left out on its own', async () => {
    const microphone = fakeTrack('audio');
    const request = vi
      .fn()
      .mockResolvedValueOnce(withTracks(fakeTrack('video')))
      .mockResolvedValueOnce(withTracks(microphone));
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      expect(request).toHaveBeenLastCalledWith({ audio: true, video: false });
      expect(media.handoff()).toEqual({ microphone });
    } finally {
      dispose();
    }
  });

  it.each(['release', 'dispose'] as const)(
    'stops a late permission result after %s without requesting another device',
    async (action) => {
      const microphone = fakeTrack('audio');
      const camera = fakeTrack('video');
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
      resolve(withTracks(microphone, camera));
      await preparing;
      expect(microphone.stop).toHaveBeenCalledOnce();
      expect(camera.stop).toHaveBeenCalledOnce();
      expect(request).toHaveBeenCalledOnce();
      expect(media.pending()).toBe(false);
      dispose();
    }
  );
});
