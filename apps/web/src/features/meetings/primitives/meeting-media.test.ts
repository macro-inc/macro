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

  it('asks for each permission in turn and previews only enabled devices', async () => {
    const { request, tracks } = fakeMediaAccess();
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      expect(request).toHaveBeenNthCalledWith(1, { audio: true, video: false });
      expect(request).toHaveBeenNthCalledWith(2, {
        audio: false,
        video: expect.objectContaining({
          width: { ideal: 1280 },
          height: { ideal: 720 },
        }),
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

  it('still requests the camera after microphone permission is denied', async () => {
    const camera = fakeTrack('video');
    const request = vi
      .fn()
      .mockRejectedValueOnce(new DOMException('Denied', 'NotAllowedError'))
      .mockResolvedValueOnce(withTracks(camera));
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      expect(request).toHaveBeenNthCalledWith(1, { audio: true, video: false });
      expect(request).toHaveBeenNthCalledWith(2, {
        audio: false,
        video: expect.any(Object),
      });
      expect(media.microphoneEnabled()).toBe(false);
      expect(media.pending()).toBe(false);
      expect(media.errors()[0]).toContain('Microphone access is blocked');
      expect(camera.stop).toHaveBeenCalledOnce();
    } finally {
      dispose();
    }
  });

  it('does not request the camera until the microphone permission settles', async () => {
    const microphone = fakeTrack('audio');
    const camera = fakeTrack('video');
    let resolveMicrophone!: (stream: MediaStream) => void;
    const request = vi.fn((constraints: MediaStreamConstraints) => {
      if (constraints.audio)
        return new Promise<MediaStream>((resolve) => {
          resolveMicrophone = resolve;
        });
      return Promise.resolve(withTracks(camera));
    });
    const { media, dispose } = setup(request);
    try {
      const preparing = media.prepare();
      await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
      expect(request).toHaveBeenCalledWith({ audio: true, video: false });
      media.setCameraEnabled(true);
      await Promise.resolve();
      expect(request).toHaveBeenCalledTimes(1);
      resolveMicrophone(withTracks(microphone));
      await preparing;
      expect(request).toHaveBeenCalledTimes(2);
      expect(media.handoff()).toEqual({ microphone, camera });
      expect(microphone.stop).not.toHaveBeenCalled();
      expect(camera.stop).not.toHaveBeenCalled();
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
      await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
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

describe('prejoin device and background settings', () => {
  beforeEach(stubMediaStream);

  it('selects devices without opening disabled inputs and captures the selected device when enabled', async () => {
    const { request, tracks } = fakeMediaAccess();
    const { media, dispose } = setup(request);
    try {
      await media.prepare();
      media.selectDevice('camera', 'camera-2');
      media.selectDevice('speaker', 'speaker-2');
      expect(request).toHaveBeenCalledTimes(2);
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.video()).toBeDefined());
      expect(request).toHaveBeenLastCalledWith({
        audio: false,
        video: expect.objectContaining({ deviceId: { exact: 'camera-2' } }),
      });
      media.selectDevice('microphone', 'mic-2');
      await vi.waitFor(() => expect(media.pending()).toBe(false));
      expect(tracks[0].stop).toHaveBeenCalledOnce();
      expect(request).toHaveBeenLastCalledWith({
        audio: { deviceId: { exact: 'mic-2' } },
        video: false,
      });
      expect(media.selectedDevices().speaker).toBe('speaker-2');
    } finally {
      dispose();
    }
  });

  it('keeps the selected camera when retrying unsupported resolution constraints', async () => {
    const camera = fakeTrack('video');
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new DOMException('Resolution', 'OverconstrainedError')
      )
      .mockResolvedValueOnce(withTracks(camera));
    const { media, dispose } = setup(request);
    try {
      media.selectDevice('camera', 'camera-2');
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.video()).toBeDefined());
      expect(request).toHaveBeenLastCalledWith({
        audio: false,
        video: { deviceId: { exact: 'camera-2' } },
      });
    } finally {
      dispose();
    }
  });

  it('disposes the processed preview while handing off the live raw camera and retaining the effect', async () => {
    const { request, tracks } = fakeMediaAccess();
    const previewTrack = fakeTrack('video');
    const stream = withTracks(previewTrack);
    const stopPreview = vi.fn();
    const processBackground = vi.fn(async () => ({
      stream,
      dispose: stopPreview,
    }));
    const { media, dispose } = createRoot((dispose) => ({
      media: createMeetingMedia({ request, processBackground }),
      dispose,
    }));
    try {
      media.setBackgroundEffect({ type: 'blur', intensity: 'medium' });
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.video()).toBe(stream));
      const camera = tracks[0];
      expect(processBackground).toHaveBeenCalledWith(camera, {
        type: 'blur',
        intensity: 'medium',
      });
      expect(media.handoff()).toEqual({ camera });
      expect(stopPreview).toHaveBeenCalledOnce();
      expect(camera.stop).not.toHaveBeenCalled();
      expect(media.backgroundEffect()).toEqual({
        type: 'blur',
        intensity: 'medium',
      });
    } finally {
      dispose();
    }
  });

  it('never exposes raw video when a requested background fails', async () => {
    const { request, tracks } = fakeMediaAccess();
    const { media, dispose } = createRoot((dispose) => ({
      media: createMeetingMedia({
        request,
        processBackground: async () => {
          throw new Error('unsupported');
        },
      }),
      dispose,
    }));
    try {
      media.setBackgroundEffect({ type: 'blur', intensity: 'light' });
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.backgroundError()).toBeDefined());
      expect(media.video()).toBeUndefined();
      expect(media.cameraEnabled()).toBe(false);
      expect(media.pending()).toBe(false);
      expect(tracks[0].stop).toHaveBeenCalledOnce();
      expect(media.handoff()).toBeUndefined();
      media.setBackgroundEffect({ type: 'none' });
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(media.video()).toBeDefined());
      expect(media.backgroundError()).toBeUndefined();
    } finally {
      dispose();
    }
  });

  it('discards an effect that finishes after the camera was turned off', async () => {
    const { request } = fakeMediaAccess();
    const stopPreview = vi.fn();
    let resolve!: (value: { stream: MediaStream; dispose: () => void }) => void;
    const processBackground = vi.fn(
      () =>
        new Promise<{ stream: MediaStream; dispose: () => void }>((done) => {
          resolve = done;
        })
    );
    const { media, dispose } = createRoot((dispose) => ({
      media: createMeetingMedia({ request, processBackground }),
      dispose,
    }));
    try {
      media.setBackgroundEffect({ type: 'blur', intensity: 'heavy' });
      media.setCameraEnabled(true);
      await vi.waitFor(() => expect(processBackground).toHaveBeenCalledOnce());
      expect(media.video()).toBeUndefined();
      expect(media.pending()).toBe(true);
      media.setCameraEnabled(false);
      resolve({ stream: withTracks(fakeTrack('video')), dispose: stopPreview });
      await vi.waitFor(() => expect(stopPreview).toHaveBeenCalledOnce());
      expect(media.video()).toBeUndefined();
      expect(media.pending()).toBe(false);
    } finally {
      dispose();
    }
  });
});
