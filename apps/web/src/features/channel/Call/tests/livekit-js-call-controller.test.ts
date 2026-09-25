import type { CallTokenResponse } from '@service-call/client';
import type { Room } from 'livekit-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectRoom = vi.fn<() => Promise<void>>();

vi.mock('livekit-client', () => ({
  Room: class {
    remoteParticipants = new Map();
    on() {}
    removeAllListeners() {}
    connect = connectRoom;
    disconnect = vi.fn(async () => undefined);
  },
  RoomEvent: {},
  Track: { Source: { ScreenShare: 'screen_share' } },
}));
vi.mock('../call-audio-receiver-stats', () => ({
  startReceiverStatsSampling: () => () => undefined,
}));

const { createLivekitJsCallController } = await import(
  '../LivekitJsCallController'
);

const token = {
  callId: 'call-1',
  channelId: null,
  serverUrl: 'wss://example.com',
  token: 'rtc-token',
} as unknown as CallTokenResponse;

function track() {
  return { stop: vi.fn() } as unknown as MediaStreamTrack & {
    stop: ReturnType<typeof vi.fn>;
  };
}

function setup(state?: { connectionState: string; room?: Room }) {
  let room: Room | null = state?.room ?? null;
  const finishLocalMediaSetup = vi.fn(async () => undefined);
  const setInitialMediaState = vi.fn();
  const controller = createLivekitJsCallController({
    room: () => room,
    setRoom: (next) => {
      room = next;
    },
    state: () =>
      ({
        activeChannelId: null,
        activeCallId: 'call-1',
        connectionState: state?.connectionState ?? 'disconnected',
      }) as never,
    currentMicrophoneCaptureOptions: () => ({}),
    isActiveConnectionState: (value) => value === 'connected',
    cancelPendingMediaSetup: () => undefined,
    nextMediaSetupVersion: () => 1,
    finishLocalMediaSetup,
    destroyProcessors: () => undefined,
    resetState: () => undefined,
    setConnectionState: () => undefined,
    setActiveCall: () => undefined,
    setDuplicateConnectCallId: () => undefined,
    setInitialMediaState,
    setRemoteParticipants: () => undefined,
    clearOptimisticJoin: () => undefined,
    bumpTrackVersion: () => undefined,
    bumpSpeakerVersion: () => undefined,
    setScreenSharing: () => undefined,
  });
  return { controller, finishLocalMediaSetup, setInitialMediaState };
}

describe('livekit call controller prejoin media', () => {
  beforeEach(() => {
    connectRoom.mockReset();
    connectRoom.mockResolvedValue(undefined);
  });

  it('claims prejoin media only once the room is connected and hands it to setup', async () => {
    const { controller, finishLocalMediaSetup, setInitialMediaState } = setup();
    const localTracks = { microphone: track(), camera: track() };
    const media = vi.fn(() => ({
      microphoneEnabled: true,
      cameraEnabled: true,
      localTracks,
    }));
    let claimedBeforeConnected = false;
    connectRoom.mockImplementation(async () => {
      claimedBeforeConnected = media.mock.calls.length > 0;
    });
    await controller.connect(token, { media });
    expect(claimedBeforeConnected).toBe(false);
    expect(media).toHaveBeenCalledOnce();
    expect(setInitialMediaState).toHaveBeenCalledWith(
      media.mock.results[0].value
    );
    expect(finishLocalMediaSetup).toHaveBeenCalledWith(
      expect.anything(),
      1,
      localTracks
    );
    expect(localTracks.microphone.stop).not.toHaveBeenCalled();
    expect(localTracks.camera.stop).not.toHaveBeenCalled();
  });

  it('never claims prejoin media when the room fails to connect', async () => {
    connectRoom.mockRejectedValue(new Error('offline'));
    const { controller, finishLocalMediaSetup } = setup();
    const media = vi.fn(() => ({
      microphoneEnabled: true,
      cameraEnabled: false,
    }));
    await expect(controller.connect(token, { media })).rejects.toThrow(
      'offline'
    );
    expect(finishLocalMediaSetup).not.toHaveBeenCalled();
    expect(media).not.toHaveBeenCalled();
  });

  it('never claims prejoin media on a duplicate connect to the active room', async () => {
    const { controller, finishLocalMediaSetup } = setup({
      connectionState: 'connected',
      room: {} as Room,
    });
    const media = vi.fn(() => ({
      microphoneEnabled: true,
      cameraEnabled: false,
    }));
    await controller.connect(token, { media });
    expect(finishLocalMediaSetup).not.toHaveBeenCalled();
    expect(media).not.toHaveBeenCalled();
  });
});
