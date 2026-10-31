import type { Span } from '@macro-inc/observability';
import type { Room } from 'livekit-client';
import { errAsync, okAsync } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenCaptureSources } from '../desktop-screen-capture';
import { ScreenShareError } from '../screen-share-error';

const native = vi.hoisted(() => ({
  list: vi.fn(),
  request: vi.fn(async () => false),
  capture: vi.fn(),
  pick: vi.fn(),
}));

vi.mock('../desktop-screen-capture', () => ({
  listScreenCaptureSources: native.list,
  requestScreenCaptureAccess: native.request,
  captureScreenSource: native.capture,
}));
vi.mock('../ScreenSourcePicker', () => ({ pickScreenSource: native.pick }));

const { startScreenShare } = await import('../screen-share');

const SOURCES: ScreenCaptureSources = {
  hasAccess: true,
  sources: [
    {
      id: 'screen:1:0',
      kind: 'screen',
      name: null,
      appName: null,
      builtin: true,
    },
  ],
};

function fakeRoom() {
  const localParticipant = {
    setScreenShareEnabled: vi.fn(async () => undefined),
    publishTrack: vi.fn(async () => undefined),
  };
  return { room: { localParticipant } as unknown as Room, localParticipant };
}

const span = { setAttr: vi.fn() } as unknown as Span;

function fakeTrack() {
  return { stop: vi.fn() } as unknown as MediaStreamTrack;
}

beforeEach(() => vi.clearAllMocks());

describe('startScreenShare', () => {
  it('uses the browser picker where the native one is missing', async () => {
    native.list.mockReturnValue(errAsync({ kind: 'unsupported' }));
    const { room, localParticipant } = fakeRoom();

    await expect(startScreenShare(room, span)).resolves.toBe('shared');
    expect(localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(true);
    expect(native.pick).not.toHaveBeenCalled();
  });

  it('publishes the picked source as the screen share', async () => {
    native.list.mockReturnValue(okAsync(SOURCES));
    native.pick.mockResolvedValue(SOURCES.sources[0]);
    const track = fakeTrack();
    native.capture.mockResolvedValue(track);
    const { room, localParticipant } = fakeRoom();

    await expect(startScreenShare(room, span)).resolves.toBe('shared');
    expect(native.capture).toHaveBeenCalledWith('screen:1:0');
    expect(localParticipant.publishTrack).toHaveBeenCalledWith(track, {
      source: 'screen_share',
    });
  });

  it('opens nothing when the picker is dismissed', async () => {
    native.list.mockReturnValue(okAsync(SOURCES));
    native.pick.mockResolvedValue(undefined);
    const { room, localParticipant } = fakeRoom();

    await expect(startScreenShare(room, span)).resolves.toBe('cancelled');
    expect(native.capture).not.toHaveBeenCalled();
    expect(localParticipant.publishTrack).not.toHaveBeenCalled();
  });

  it('asks for Screen Recording access when macOS refuses capture', async () => {
    native.list.mockReturnValue(okAsync(SOURCES));
    native.pick.mockResolvedValue(SOURCES.sources[0]);
    native.capture.mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError')
    );
    const { room } = fakeRoom();

    const started = startScreenShare(room, span);
    await expect(started).rejects.toBeInstanceOf(ScreenShareError);
    await expect(started).rejects.toThrow('Screen Recording');
  });

  it('stops the captured track when publishing fails', async () => {
    native.list.mockReturnValue(okAsync(SOURCES));
    native.pick.mockResolvedValue(SOURCES.sources[0]);
    const track = fakeTrack();
    native.capture.mockResolvedValue(track);
    const { room, localParticipant } = fakeRoom();
    localParticipant.publishTrack.mockRejectedValue(new Error('closed'));

    await expect(startScreenShare(room, span)).rejects.toThrow(
      "Couldn't share your screen"
    );
    expect(track.stop).toHaveBeenCalled();
  });
});
