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
    setInitialMediaState: () => undefined,
    setRemoteParticipants: () => undefined,
    clearOptimisticJoin: () => undefined,
    bumpTrackVersion: () => undefined,
    bumpSpeakerVersion: () => undefined,
    setScreenSharing: () => undefined,
  });
  return { controller, finishLocalMediaSetup };
}

describe('livekit call controller prejoin tracks', () => {
  beforeEach(() => {
    connectRoom.mockReset();
    connectRoom.mockResolvedValue(undefined);
  });

  it('hands prejoin tracks to media setup instead of stopping them', async () => {
    const { controller, finishLocalMediaSetup } = setup();
    const localTracks = { microphone: track(), camera: track() };
    await controller.connect(token, { localTracks });
    expect(finishLocalMediaSetup).toHaveBeenCalledWith(
      expect.anything(),
      1,
      localTracks
    );
    expect(localTracks.microphone.stop).not.toHaveBeenCalled();
    expect(localTracks.camera.stop).not.toHaveBeenCalled();
  });

  it('stops prejoin tracks when the room fails to connect', async () => {
    connectRoom.mockRejectedValue(new Error('offline'));
    const { controller, finishLocalMediaSetup } = setup();
    const localTracks = { microphone: track(), camera: track() };
    await expect(controller.connect(token, { localTracks })).rejects.toThrow(
      'offline'
    );
    expect(finishLocalMediaSetup).not.toHaveBeenCalled();
    expect(localTracks.microphone.stop).toHaveBeenCalledOnce();
    expect(localTracks.camera.stop).toHaveBeenCalledOnce();
  });

  it('stops prejoin tracks on a duplicate connect to the active room', async () => {
    const { controller, finishLocalMediaSetup } = setup({
      connectionState: 'connected',
      room: {} as Room,
    });
    const localTracks = { camera: track() };
    await controller.connect(token, { localTracks });
    expect(finishLocalMediaSetup).not.toHaveBeenCalled();
    expect(localTracks.camera.stop).toHaveBeenCalledOnce();
  });
});
